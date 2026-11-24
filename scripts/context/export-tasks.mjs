#!/usr/bin/env node
// Exports context/plan/tasks.yaml to the task board (GitHub Issues), one issue per task,
// tagged with its requirement versions. Re-running updates issues whose plan changed.
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/context/export-tasks.mjs [--dry-run]
import { loadPlan, loadRequirements, fmtRef, arg } from './lib.mjs';
import { github } from './github.mjs';

const plan = loadPlan();
const reqs = new Map(loadRequirements().map((r) => [r.id, r]));
const bodyFor = (t) => [
  `Implements: ${t.implements.map(fmtRef).join(', ')}`,
  '',
  `**Module:** ${t.module}  `,
  `**Suggested owner:** ${t.owner || 'unassigned'}  `,
  `**Depends on:** ${t.depends_on.length ? t.depends_on.join(', ') : 'nothing'}`,
  '',
  '### Requirements',
  ...t.implements.map((r) => `- **${fmtRef(r)}** ${reqs.get(r.id)?.title ?? ''} — \`context/requirements/${r.id}.md\``),
  '',
  `Start by reading the task context: \`get_task_context("${t.id}")\` on the context server.`,
  '',
  `<!-- task-id: ${t.id} -->`,
].join('\n');

const gh = github();
if (!gh || arg('dry-run')) {
  for (const t of plan) console.log(`[${t.id}] ${t.title}\n${bodyFor(t)}\n`);
  if (!gh) console.log('(dry run: set GITHUB_TOKEN and GITHUB_REPOSITORY to create issues)');
  process.exit(0);
}

await gh.ensureLabel('task', '1d76db', 'Task from context/plan/tasks.yaml');
const existing = await gh.openIssues('task');
for (const t of plan) {
  const title = `[${t.id}] ${t.title}`;
  const body = bodyFor(t);
  const labels = ['task', `module:${t.module}`];
  const found = existing.find((i) => i.body?.includes(`<!-- task-id: ${t.id} -->`));
  if (!found) {
    const issue = await gh.api('POST', '/repos/{repo}/issues', { title, body, labels });
    console.log(`created #${issue.number} ${title}`);
  } else if (found.body !== body || found.title !== title) {
    await gh.api('PATCH', `/repos/{repo}/issues/${found.number}`, { title, body });
    console.log(`updated #${found.number} ${title}`);
  } else {
    console.log(`unchanged #${found.number} ${title}`);
  }
}
