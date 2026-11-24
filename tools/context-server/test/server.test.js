// The context server through a real MCP client: tools, task slices, and push alerts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { ROOT } from '../../../scripts/context/lib.mjs';
import { ContextIndex } from '../src/context.js';
import { createMcpServer, broadcastChanges } from '../src/mcp.js';
import { createHttpApp } from '../src/index.js';

let root, index, hub, client, stopWatch;
const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'ctx-server-'));
  cpSync(join(ROOT, 'context'), join(root, 'context'), { recursive: true });
  index = new ContextIndex({ root });
  hub = { servers: new Set() };
  index.on('changed', (c) => broadcastChanges(hub, index, c));
  stopWatch = index.watch();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(index, hub).connect(a);
  client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(b);
});

after(async () => {
  stopWatch();
  await client.close();
  rmSync(root, { recursive: true, force: true });
});

test('exposes the six tools from the architecture', async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  for (const n of ['get_task_context', 'get_context_version', 'get_requirement', 'propose_change', 'propose_decision', 'report_assumption']) assert.ok(names.includes(n), n);
});

test('get_task_context returns only the task slice, stamped with versions', async () => {
  const c = await call('get_task_context', { taskId: 'T-04' });
  assert.equal(c.contextVersion, index.version);
  assert.deepEqual(c.task.implements, ['REQ-004@v1']);
  assert.equal(c.stale, false);
  assert.equal(c.pullRequestLine, 'Implements: REQ-004@v1');
  assert.deepEqual(c.requirements.map((r) => r.id), ['REQ-004']);
  assert.ok(c.contract.some((o) => o.operation === 'POST /invitations'));
  assert.ok(!c.contract.some((o) => o.operation === 'GET /audit-events'), 'no unrelated operations');
  assert.ok(c.decisions.some((d) => d.id === 'ADR-005'));
  assert.match(c.rules, /Implements: REQ-xxx@vN/);
});

test('get_requirement shows pending change requests', async () => {
  const r = await call('get_requirement', { id: 'REQ-004' });
  assert.equal(r.version, 1);
  assert.deepEqual(r.pendingChangeRequests.map((c) => c.id), ['CR-002']);
});

test('a requirement change pushes notifications/resources/updated and turns the task stale', async () => {
  await client.subscribeResource({ uri: 'context://requirements/REQ-004' });
  await client.subscribeResource({ uri: 'context://tasks/T-04' });
  const got = new Set();
  const updated = new Promise((resolve) => {
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      got.add(n.params.uri);
      if (got.has('context://requirements/REQ-004') && got.has('context://tasks/T-04')) resolve();
    });
  });
  const file = join(root, 'context/requirements/REQ-004.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('version: 1', 'version: 2').replace('72 hours', '48 hours'));
  await Promise.race([updated, new Promise((_, rej) => setTimeout(() => rej(new Error('no notification within 3 s')), 3000))]);

  const c = await call('get_task_context', { taskId: 'T-04' });
  assert.equal(c.stale, true);
  assert.deepEqual(c.staleReasons, ['REQ-004 is now v2 (planned v1)']);
  assert.equal(c.pullRequestLine, 'Implements: REQ-004@v2');
});

test('proposals are queued for people, never applied', async () => {
  const r = await call('propose_change', { text: 'Should admins be able to resend an expired invitation?', requirementId: 'REQ-004', agent: 'dev-agent-3' });
  assert.equal(r.status, 'queued');
  assert.match(readFileSync(r.where, 'utf8'), /resend an expired invitation/);
  const calls = readFileSync(join(root, '.context-logs/calls.jsonl'), 'utf8');
  assert.match(calls, /"tool":"get_task_context"/);
});

test('the HTTP transport serves MCP and the read-only overview', async () => {
  const app = createHttpApp(index, hub);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = `http://localhost:${server.address().port}`;
  const remote = new Client({ name: 'remote-agent', version: '1.0.0' });
  await remote.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  const v = JSON.parse((await remote.callTool({ name: 'get_context_version', arguments: {} })).content[0].text);
  assert.equal(v.contextVersion, index.version);
  const overview = await (await fetch(`${url}/api/overview`)).json();
  assert.equal(overview.tasks.find((t) => t.id === 'T-04').stale, true);
  await remote.close();
  server.close();
});
