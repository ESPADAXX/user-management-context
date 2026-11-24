#!/usr/bin/env node
// Gate: trace check.
// - every approved requirement has a task in the plan and an acceptance test
// - every acceptance test checks the current version (tests change before code)
// - every contract operation lists x-requirements, all approved
// - code only references approved requirements
// On a context-only pull request, tests lagging behind a new version are warnings:
// QA updates them in the next pull request, which cannot merge until they pass.
//   node scripts/context/check-trace.mjs [--base origin/main]
import { diskSource, loadRequirements, loadPlan, loadContract, loadAcceptanceTests, changedFiles, arg, report } from './lib.mjs';

const src = diskSource();
const errors = [];
const warnings = [];
const ok = [];

const files = arg('base') ? changedFiles(arg('base')) : null;
const contextOnly = Boolean(files && files.length && files.every((f) => f.startsWith('context/')));
const lag = contextOnly ? warnings : errors;

const reqs = loadRequirements(src);
const approved = new Map(reqs.filter((r) => r.status === 'approved').map((r) => [r.id, r]));
const plan = loadPlan(src);
const tests = loadAcceptanceTests(src);
const { operations } = loadContract(src);

for (const [id, r] of approved) {
  const tasks = plan.filter((t) => t.implements.some((x) => x.id === id));
  if (!tasks.length) errors.push(`${id} has no task in context/plan/tasks.yaml`);
  for (const t of tasks) {
    const ref = t.implements.find((x) => x.id === id);
    if (ref.version !== r.version) warnings.push(`${t.id} plans ${id}@v${ref.version}; current is v${r.version} (task is stale until re-planned)`);
  }
  const test = tests.find((t) => t.id === id);
  if (!test) errors.push(`${id} has no acceptance test (apps/api/test/acceptance/${id}.test.js)`);
  else if (test.declaredId !== id || test.version === null) errors.push(`${test.file} must start with describe('${id}@v${r.version} …')`);
  else if (test.version !== r.version) lag.push(`${test.file} checks ${id}@v${test.version}, but the requirement is v${r.version}: rewrite the test first`);
  else ok.push(`${id}@v${r.version}: ${tasks.length} task(s), acceptance test current`);
}

for (const t of tests) {
  if (!approved.has(t.id)) errors.push(`${t.file} tests ${t.id}, which is not an approved requirement`);
}

for (const op of operations) {
  const label = `${op.method} ${op.path}`;
  if (!Array.isArray(op.requirements)) { errors.push(`contract: ${label} has no x-requirements`); continue; }
  if (op.requirements.length === 0 && !op.op['x-internal-purpose']) errors.push(`contract: ${label} lists no requirement (add one, or x-internal-purpose for operational endpoints)`);
  for (const id of op.requirements) if (!approved.has(id)) errors.push(`contract: ${label} references ${id}, which is not approved`);
}
ok.push(`${operations.length} contract operations traced`);

// Code references such as "// REQ-004" must point to approved requirements.
for (const f of src.list('apps/api/src').concat(src.list('apps/web/src'))) {
  for (const m of src.read(f).matchAll(/\bREQ-\d+\b/g)) {
    if (!approved.has(m[0])) errors.push(`${f} references ${m[0]}, which is not approved`);
  }
}

process.exit(report({ errors, warnings, ok }, `Trace check${contextOnly ? ' (context-only pull request)' : ''}`));
