// The MCP server: tools and resources over the context index.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const notFound = (what) => ({ content: [{ type: 'text', text: `${what} not found` }], isError: true });

/**
 * @param {import('./context.js').ContextIndex} index
 * @param {{ servers: Set<any> }} hub  every live server, so changes reach every client
 */
export function createMcpServer(index, hub) {
  const server = new McpServer(
    { name: 'user-management-context', version: '1.0.0' },
    {
      capabilities: { resources: { subscribe: true, listChanged: true }, logging: {} },
      instructions: 'Shared context for the user-management app. Start every task with get_task_context(taskId) and work only from it. Before a pull request, call get_context_version() and re-read your task if anything changed. Declare "Implements: REQ-xxx@vN" in every pull request. Never invent a rule: use propose_change or propose_decision.',
    },
  );
  const subscriptions = new Set();
  const entry = { server, subscriptions };
  hub.servers.add(entry);

  server.server.setRequestHandler(SubscribeRequestSchema, async (req) => { subscriptions.add(req.params.uri); return {}; });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => { subscriptions.delete(req.params.uri); return {}; });
  server.server.onclose = () => hub.servers.delete(entry);

  const logged = (tool, fn) => async (args) => {
    const out = await fn(args);
    index.log({ tool, args });
    return out;
  };

  // ---------- tools (Component 4 of the architecture) ----------
  server.registerTool('get_task_context', {
    title: 'Get task context',
    description: "The task's requirements (current versions, rules, acceptance criteria), related ADRs, contract excerpt, architecture notes, glossary and rules, stamped with the context version. Start every task here.",
    inputSchema: { taskId: z.string().describe('Task id from context/plan/tasks.yaml, e.g. T-04') },
    annotations: { readOnlyHint: true },
  }, logged('get_task_context', ({ taskId }) => {
    const c = index.taskContext(taskId);
    return c ? json(c) : notFound(`Task ${taskId}`);
  }));

  server.registerTool('get_context_version', {
    title: 'Get context version',
    description: 'The current context version and the version of every requirement and decision. Call before a task and before opening a pull request.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, logged('get_context_version', () => json(index.contextVersion())));

  server.registerTool('get_requirement', {
    title: 'Get requirement',
    description: 'One requirement with its rule, acceptance criteria, changelog, git history and pending change requests.',
    inputSchema: { id: z.string().describe('e.g. REQ-004') },
    annotations: { readOnlyHint: true },
  }, logged('get_requirement', ({ id }) => {
    const r = index.requirement(id);
    return r ? json(r) : notFound(id);
  }));

  server.registerTool('get_decision', {
    title: 'Get decision',
    description: 'One architecture decision record (ADR).',
    inputSchema: { id: z.string().describe('e.g. ADR-002') },
    annotations: { readOnlyHint: true },
  }, logged('get_decision', ({ id }) => {
    const d = index.decision(id);
    return d ? json(d) : notFound(id);
  }));

  server.registerTool('propose_change', {
    title: 'Propose a change',
    description: 'A need the context does not cover, found while working. Opens a change request for the product owner. Never implement it before approval.',
    inputSchema: { text: z.string().min(10), requirementId: z.string().optional(), taskId: z.string().optional(), agent: z.string().optional() },
  }, async (args) => json(await index.propose('change', args)));

  server.registerTool('propose_decision', {
    title: 'Propose a decision',
    description: 'A technical choice no ADR covers. Opens a question for the tech lead. Wait for the answer.',
    inputSchema: { text: z.string().min(10), taskId: z.string().optional(), agent: z.string().optional() },
  }, async (args) => json(await index.propose('decision', args)));

  server.registerTool('report_assumption', {
    title: 'Report an assumption',
    description: 'Log an assumption you had to make, for human review.',
    inputSchema: { text: z.string().min(5), taskId: z.string().optional(), agent: z.string().optional() },
  }, async (args) => json(await index.propose('assumption', args)));

  // ---------- resources (subscribe to get notifications/resources/updated) ----------
  const text = (uri, data, mimeType = 'application/json') => ({ contents: [{ uri: uri.href, mimeType, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });

  server.registerResource('manifest', 'context://manifest', { title: 'Context manifest', mimeType: 'application/json' }, (uri) => text(uri, index.contextVersion()));
  server.registerResource('rules', 'context://rules', { title: 'Rules every agent follows (AGENTS.md)', mimeType: 'text/markdown' }, (uri) => text(uri, index.snapshot.rules, 'text/markdown'));
  server.registerResource('glossary', 'context://glossary', { title: 'Glossary', mimeType: 'text/markdown' }, (uri) => text(uri, index.snapshot.glossary, 'text/markdown'));

  server.registerResource('requirement', new ResourceTemplate('context://requirements/{id}', {
    list: () => ({ resources: index.snapshot.requirements.map((r) => ({ uri: `context://requirements/${r.id}`, name: `${r.id}@v${r.version} ${r.title}`, mimeType: 'application/json' })) }),
  }), { title: 'Requirement' }, (uri, { id }) => text(uri, index.requirement(String(id)) ?? { error: 'not found' }));

  server.registerResource('decision', new ResourceTemplate('context://decisions/{id}', {
    list: () => ({ resources: index.snapshot.decisions.map((d) => ({ uri: `context://decisions/${d.id}`, name: `${d.id} ${d.title}`, mimeType: 'application/json' })) }),
  }), { title: 'Decision' }, (uri, { id }) => text(uri, index.decision(String(id)) ?? { error: 'not found' }));

  server.registerResource('task', new ResourceTemplate('context://tasks/{id}', {
    list: () => ({ resources: index.snapshot.plan.map((t) => ({ uri: `context://tasks/${t.id}`, name: `${t.id} ${t.title}`, mimeType: 'application/json' })) }),
  }), { title: 'Task context slice' }, (uri, { id }) => text(uri, index.taskContext(String(id)) ?? { error: 'not found' }));

  return server;
}

// When the context changes, tell every subscribed client which resources changed.
export function broadcastChanges(hub, index, change) {
  const uris = new Set(['context://manifest']);
  for (const id of change.requirements) {
    uris.add(`context://requirements/${id}`);
    for (const t of index.snapshot.plan) if (t.implements.some((r) => r.id === id)) uris.add(`context://tasks/${t.id}`);
  }
  for (const id of change.decisions) uris.add(`context://decisions/${id}`);
  for (const { server, subscriptions } of hub.servers) {
    for (const uri of uris) if (subscriptions.has(uri)) server.server.sendResourceUpdated({ uri }).catch(() => {});
    server.server.sendResourceListChanged?.();
  }
  return [...uris];
}
