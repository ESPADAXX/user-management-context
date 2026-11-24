#!/usr/bin/env node
// Validates the context folder, and (with --base) the versioning rules against the base branch:
// - rule or acceptance criteria changed → version must go up by exactly 1, with a changelog entry
// - version went up but nothing changed → refused (a typo fix does not bump)
// - nothing is deleted: deprecate or supersede instead
//   node scripts/context/validate-context.mjs [--base origin/main]
import { diskSource, gitSource, loadRequirements, loadDecisions, loadPlan, loadChangeRequests, REQ_STATUSES, ADR_STATUSES, arg, report } from './lib.mjs';

const EARS = /^(?:(?:WHEN|WHILE|WHERE) .+?, |IF .+?, THEN )?THE SYSTEM SHALL /;
const errors = [];
const warnings = [];
const ok = [];

const src = diskSource();
const reqs = loadRequirements(src);
const reqIds = new Set(reqs.map((r) => r.id));

for (const r of reqs) {
  const where = `${r.file}:`;
  if (!r.file.endsWith(`/${r.id}.md`)) errors.push(`${where} id ${r.id} does not match the file name`);
  for (const f of ['id', 'title', 'version', 'status', 'owner', 'source']) if (r[f] === undefined || r[f] === '') errors.push(`${where} missing "${f}"`);
  if (!Number.isInteger(r.version) || r.version < 1) errors.push(`${where} version must be an integer ≥ 1`);
  if (!REQ_STATUSES.includes(r.status)) errors.push(`${where} status "${r.status}" must be one of ${REQ_STATUSES.join(', ')}`);
  if (!r.affects.length) errors.push(`${where} "affects" must list at least one module`);
  if (!r.rule.length) errors.push(`${where} the Rule section is empty`);
  for (const line of r.rule) if (!EARS.test(line)) errors.push(`${where} rule is not EARS: "${line}"`);
  if (!r.acceptance.length) errors.push(`${where} no acceptance criteria`);
  if (r.status !== 'deprecated' && !String(r.changelog[0] || '').startsWith(`v${r.version} `)) errors.push(`${where} the newest changelog line must start with "v${r.version} "`);
}

const decisions = loadDecisions(src);
for (const d of decisions) {
  if (!d.file.endsWith(`/${d.id}.md`)) errors.push(`${d.file}: id ${d.id} does not match the file name`);
  if (!ADR_STATUSES.includes(d.status)) errors.push(`${d.file}: status "${d.status}" must be one of ${ADR_STATUSES.join(', ')}`);
  for (const id of d.requirements) if (!reqIds.has(id)) errors.push(`${d.file}: references unknown ${id}`);
}

let plan = [];
try { plan = loadPlan(src); } catch (e) { errors.push(`context/plan/tasks.yaml: ${e.message}`); }
const taskIds = new Set();
for (const t of plan) {
  if (taskIds.has(t.id)) errors.push(`plan: duplicate task id ${t.id}`);
  taskIds.add(t.id);
  if (!t.implements.length) errors.push(`plan: ${t.id} implements no requirement`);
  for (const ref of t.implements) if (!reqIds.has(ref.id)) errors.push(`plan: ${t.id} implements unknown ${ref.id}`);
}
for (const t of plan) for (const dep of t.depends_on) if (!taskIds.has(dep)) errors.push(`plan: ${t.id} depends on unknown ${dep}`);

for (const c of loadChangeRequests(src)) {
  if (!['draft', 'approved', 'rejected'].includes(c.status)) errors.push(`${c.file}: status must be draft, approved or rejected`);
  if (c.type !== 'new' && !reqIds.has(c.target)) errors.push(`${c.file}: target ${c.target} not found`);
}

// ---- versioning rules against the base branch ----
const base = arg('base');
if (base) {
  const before = gitSource(base);
  const old = new Map(loadRequirements(before).map((r) => [r.id, r]));
  for (const [id, o] of old) {
    const n = reqs.find((r) => r.id === id);
    if (!n) { errors.push(`${id} was deleted. Nothing is deleted: set status deprecated or superseded.`); continue; }
    const changed = JSON.stringify([o.rule, o.acceptance]) !== JSON.stringify([n.rule, n.acceptance]);
    if (n.version < o.version) errors.push(`${id}: version went down (v${o.version} → v${n.version})`);
    else if (changed && n.version !== o.version + 1) errors.push(`${id}: rule or acceptance criteria changed, so the version must go from v${o.version} to v${o.version + 1} (found v${n.version})`);
    else if (!changed && n.version !== o.version) errors.push(`${id}: version changed but the rule and acceptance criteria did not (a typo fix does not bump)`);
    else if (changed) ok.push(`${id}: v${o.version} → v${n.version}`);
    if (o.status !== n.status) ok.push(`${id}: status ${o.status} → ${n.status}`);
  }
  for (const d of loadDecisions(before)) if (!decisions.find((x) => x.id === d.id)) errors.push(`${d.id} was deleted. Supersede it with a new ADR instead.`);
}

ok.unshift(`${reqs.length} requirements, ${decisions.length} decisions, ${plan.length} tasks checked`);
process.exit(report({ errors, warnings, ok }, `Context validation${base ? ` (against ${base})` : ''}`));
