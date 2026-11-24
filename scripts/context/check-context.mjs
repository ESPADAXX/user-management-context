#!/usr/bin/env node
// Gate: stale-context check. Fails a pull request built on an outdated requirement version.
//   PR_BODY="Implements: REQ-004@v2" node scripts/context/check-context.mjs [--base origin/main]
// Context-only pull requests (only files under context/) declare "Change-Request: CR-xxx" instead.
// Pull requests that touch no app code may declare "Chore: <reason>".
import { readFileSync } from 'node:fs';
import { diskSource, readManifest, parseImplements, changedFiles, arg, report } from './lib.mjs';

const body = arg('body-file') ? readFileSync(arg('body-file'), 'utf8') : (process.env.PR_BODY ?? '');
const manifest = readManifest(diskSource());
const errors = [];
const ok = [];
const warnings = [];

const files = arg('base') ? changedFiles(arg('base')) : null;
const contextOnly = files && files.length > 0 && files.every((f) => f.startsWith('context/'));
const touchesApps = files ? files.some((f) => f.startsWith('apps/')) : true;
const claims = parseImplements(body);

if (claims.length === 0) {
  if (contextOnly && /Change-Request:\s*CR-\d+/i.test(body)) ok.push('Context-only pull request linked to a change request');
  else if (!touchesApps && /Chore:\s*\S+/i.test(body)) ok.push('Chore pull request (no app code changed)');
  else errors.push('Declare what this pull request implements, e.g. "Implements: REQ-004@v1"' + (contextOnly ? ' or "Change-Request: CR-002"' : ''));
}

for (const { id, version } of claims) {
  const current = manifest.requirements[id];
  if (manifest.deprecated?.[id] !== undefined) errors.push(`${id} is deprecated; it must not be implemented or shipped`);
  else if (current === undefined) errors.push(`${id} is not an approved requirement`);
  else if (version !== current) errors.push(`${id}: built on v${version}, current is v${current}. Re-read the task context and update your work.`);
  else ok.push(`${id}@v${version} is current`);
}

console.log(`Context version: v${manifest.contextVersion}`);
process.exit(report({ errors, warnings, ok }, 'Stale-context check'));
