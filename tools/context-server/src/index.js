#!/usr/bin/env node
// Context server.
//   node src/index.js          MCP over stdio (for a coding agent on a developer's machine)
//   node src/index.js --http   MCP over Streamable HTTP at /mcp + a live read-only viewer at /
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { ContextIndex } from './context.js';
import { createMcpServer, broadcastChanges } from './mcp.js';

const here = dirname(fileURLToPath(import.meta.url));

export function createHttpApp(index, hub) {
  const app = express();
  app.disable('x-powered-by');
  const sse = new Set();

  index.on('changed', (change) => {
    const uris = broadcastChanges(hub, index, change);
    const msg = `data: ${JSON.stringify({ ...change, uris })}\n\n`;
    for (const res of sse) res.write(msg);
  });

  // Optional bearer token for the MCP endpoint (CONTEXT_TOKEN).
  const guard = (req, res, next) => {
    const need = process.env.CONTEXT_TOKEN;
    if (need && req.get('authorization') !== `Bearer ${need}`) return res.status(401).json({ error: 'unauthorized' });
    next();
  };

  // ---- MCP over Streamable HTTP, one session per client ----
  const transports = new Map();
  app.post('/mcp', guard, express.json({ limit: '1mb' }), async (req, res) => {
    const id = req.get('mcp-session-id');
    let transport = id ? transports.get(id) : null;
    if (!transport) {
      if (id || !isInitializeRequest(req.body)) return res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session' }, id: null });
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (sid) => transports.set(sid, transport) });
      transport.onclose = () => transport.sessionId && transports.delete(transport.sessionId);
      await createMcpServer(index, hub).connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });
  const session = async (req, res) => {
    const transport = transports.get(req.get('mcp-session-id'));
    if (!transport) return res.status(400).send('No valid session');
    await transport.handleRequest(req, res);
  };
  app.get('/mcp', guard, session);
  app.delete('/mcp', guard, session);

  // ---- read-only JSON + live events for people (and the viewer) ----
  app.get('/api/overview', (_req, res) => res.json(index.overview()));
  app.get('/api/version', (_req, res) => res.json(index.contextVersion()));
  app.get('/api/requirements/:id', (req, res) => { const r = index.requirement(req.params.id); r ? res.json(r) : res.status(404).json({ error: 'not found' }); });
  app.get('/api/tasks/:id/context', (req, res) => { const c = index.taskContext(req.params.id); c ? res.json(c) : res.status(404).json({ error: 'not found' }); });
  app.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ hello: true, contextVersion: index.version })}\n\n`);
    sse.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); sse.delete(res); });
  });
  app.use(express.static(join(here, '../public')));
  return app;
}

async function main() {
  const index = new ContextIndex();
  const hub = { servers: new Set() };
  index.watch();

  if (process.argv.includes('--http')) {
    const port = Number(process.env.CONTEXT_PORT || process.env.PORT || 4000);
    createHttpApp(index, hub).listen(port, () => {
      console.log(`Context server (context v${index.version})`);
      console.log(`  viewer: http://localhost:${port}/`);
      console.log(`  MCP:    http://localhost:${port}/mcp`);
    });
  } else {
    index.on('changed', (change) => broadcastChanges(hub, index, change));
    await createMcpServer(index, hub).connect(new StdioServerTransport());
    console.error(`Context server on stdio (context v${index.version})`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
