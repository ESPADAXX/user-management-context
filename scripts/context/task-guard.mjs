#!/usr/bin/env node
// Runs on issue events. Enforces the task states: Ready → In progress → Stale → Done.
// - A task closed while built on an outdated requirement version is reopened and labeled stale.
// - A stale task whose Implements line is updated to the current versions loses the stale label.
import { readFileSync } from 'node:fs';
import { diskSource, readManifest, parseImplements, fmtRef } from './lib.mjs';
import { github } from './github.mjs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const issue = event.issue;
if (!issue || issue.pull_request) process.exit(0);
const claims = parseImplements(issue.body);
if (!claims.length) process.exit(0);

const manifest = readManifest(diskSource());
const outdated = claims.filter((c) => manifest.requirements[c.id] !== c.version);
const isStale = issue.labels.some((l) => l.name === 'stale');
const gh = github();

if (event.action === 'closed' && (isStale || outdated.length)) {
  await gh.api('PATCH', `/repos/{repo}/issues/${issue.number}`, { state: 'open' });
  await gh.addLabels(issue.number, ['stale']);
  await gh.comment(issue.number, `↩ Reopened: a stale task cannot be Done. Outdated: ${outdated.map((c) => `${fmtRef(c)} (current v${manifest.requirements[c.id] ?? 'deprecated'})`).join(', ') || 'see the stale label'}.`);
  console.log(`#${issue.number} reopened`);
} else if (event.action === 'edited' && isStale && outdated.length === 0) {
  await gh.removeLabel(issue.number, 'stale');
  await gh.comment(issue.number, `✔ Re-synced to ${claims.map(fmtRef).join(', ')} (context v${manifest.contextVersion}).`);
  console.log(`#${issue.number} re-synced`);
} else if (outdated.length && !isStale && event.action !== 'closed') {
  await gh.addLabels(issue.number, ['stale']);
  console.log(`#${issue.number} marked stale`);
}
