#!/usr/bin/env node
// Impact analyzer: when a requirement changes, find every linked task, test, contract
// operation, source file, issue and pull request, and (with --apply) mark them stale.
// It is a query over trace links (REQ ids), not a guess.
//   node scripts/context/impact.mjs --base <ref> [--head HEAD] [--out report.md] [--apply]
import { writeFileSync } from 'node:fs';
import { diskSource, gitSource, loadRequirements, loadPlan, loadAcceptanceTests, loadContract, parseImplements, readManifest, arg } from './lib.mjs';
import { github, notifyChat } from './github.mjs';

const base = arg('base');
if (!base) { console.error('Usage: impact.mjs --base <git ref> [--head <ref>] [--out file] [--apply]'); process.exit(2); }
const headRef = arg('head');
const head = headRef ? gitSource(headRef) : diskSource();
const before = new Map(loadRequirements(gitSource(base)).map((r) => [r.id, r]));
const after = loadRequirements(head);

const changes = [];
for (const r of after) {
  const o = before.get(r.id);
  if (!o) { if (r.status === 'approved') changes.push({ id: r.id, kind: 'new', from: null, to: r.version, req: r }); continue; }
  if (o.version !== r.version || o.status !== r.status) {
    changes.push({ id: r.id, kind: r.status !== 'approved' ? r.status : 'changed', from: o.version, to: r.version, req: r });
  }
}

const plan = loadPlan(head);
const tests = loadAcceptanceTests(head);
const { operations } = loadContract(head);
const sourceFiles = head.list('apps').filter((f) => /\.(m?js|jsx|ts|tsx)$/.test(f) && !f.includes('/acceptance/'));
const gh = github();
const [issues, pulls] = gh ? await Promise.all([gh.openIssues(), gh.openPulls()]) : [[], []];

const impact = changes.map((c) => {
  const outdated = (ref) => ref.id === c.id && (c.kind !== 'changed' || ref.version !== c.to);
  return {
    ...c,
    tasks: plan.filter((t) => t.implements.some(outdated)).map((t) => t.id),
    tests: tests.filter((t) => t.id === c.id && t.version !== c.to).map((t) => `${t.file} (checks v${t.version})`),
    operations: operations.filter((o) => (o.requirements || []).includes(c.id)).map((o) => `${o.method} ${o.path}`),
    code: sourceFiles.filter((f) => head.read(f).includes(c.id)),
    issues: issues.filter((i) => parseImplements(i.body).some(outdated)).map((i) => ({ number: i.number, title: i.title, url: i.html_url })),
    pulls: pulls.filter((p) => parseImplements(p.body).some(outdated)).map((p) => ({ number: p.number, title: p.title, url: p.html_url })),
  };
});

const manifest = readManifest(head);
const md = [];
md.push(`## Context impact report`);
if (!impact.length) md.push('No requirement version or status changed.');
for (const i of impact) {
  const title = i.kind === 'new' ? `**${i.id}** is new (v${i.to})` : i.kind === 'changed' ? `**${i.id}** v${i.from} → v${i.to}` : `**${i.id}** is now ${i.kind}`;
  md.push(`\n### ${title} — ${i.req.title}`);
  md.push(`Affects: ${i.req.affects.join(', ')}`);
  const list = (label, items, fmt = (x) => x) => md.push(`- ${label}: ${items.length ? items.map(fmt).join(', ') : 'none'}`);
  list('Plan tasks to re-plan', i.tasks);
  list('Acceptance tests to rewrite first', i.tests);
  list('Contract operations', i.operations);
  list('Source files referencing it', i.code);
  list('Open task issues → stale', i.issues, (x) => `#${x.number}`);
  list('Open pull requests → stale', i.pulls, (x) => `#${x.number}`);
}
if (manifest) md.push(`\nContext version after merge: **v${manifest.contextVersion}**`);
const text = md.join('\n');
console.log(text);
if (arg('out')) writeFileSync(arg('out'), text + '\n');

if (arg('apply') && impact.length) {
  if (gh) {
    await gh.ensureLabel('stale', 'd93f0b', 'Built on an outdated requirement version');
    for (const i of impact) {
      for (const x of [...i.issues, ...i.pulls]) {
        await gh.addLabels(x.number, ['stale']);
        await gh.comment(x.number, `⚠ **Stale**: ${i.id} changed (${i.from ? `v${i.from} → ` : ''}v${i.to}${i.kind !== 'changed' ? `, ${i.kind}` : ''}). Re-read the task context, update the \`Implements:\` line to \`${i.id}@v${i.to}\`, and update the work. This item cannot be closed or merged until then.`);
      }
    }
  }
  const lines = impact.map((i) => `• ${i.id} ${i.from ? `v${i.from} → ` : ''}v${i.to} (${i.req.title}): ${i.issues.length + i.pulls.length} item(s) marked stale${i.tasks.length ? `, tasks ${i.tasks.join(', ')}` : ''}`);
  const sent = await notifyChat(`Context v${manifest?.contextVersion} merged in ${process.env.GITHUB_REPOSITORY || 'the repo'}\n${lines.join('\n')}`);
  console.log(`\nApplied: labels ${gh ? 'updated' : 'skipped (no GITHUB_TOKEN)'}, ${sent} chat webhook(s) notified.`);
}
