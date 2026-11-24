// Shared reader for the context/ folder. Plain code, no AI: same input, same answer.
// Used by the CI gates, the impact analyzer and the MCP context server.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CONTEXT_DIR = 'context';
export const ACCEPTANCE_DIR = 'apps/api/test/acceptance';
export const REQ_STATUSES = ['draft', 'approved', 'deprecated', 'superseded'];
export const ADR_STATUSES = ['proposed', 'accepted', 'deprecated', 'superseded'];

// ---------- file access: working tree, or any git ref ----------
// A "source" reads files either from disk or from a commit, so the same code
// can compare the base branch with the pull request.
export function diskSource(root = ROOT) {
  return {
    root,
    ref: null,
    exists: (p) => existsSync(join(root, p)),
    read: (p) => readFileSync(join(root, p), 'utf8'),
    list: (dir) => (existsSync(join(root, dir)) ? walk(join(root, dir)).map((f) => relative(root, f).split('\\').join('/')) : []),
  };
}

export function gitSource(ref, root = ROOT) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let files;
  try {
    files = git('ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean);
  } catch {
    files = [];
  }
  const set = new Set(files);
  return {
    root,
    ref,
    exists: (p) => set.has(p),
    read: (p) => git('show', `${ref}:${p}`),
    list: (dir) => files.filter((f) => f.startsWith(`${dir}/`)),
  };
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// ---------- markdown with front matter ----------
export function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  return { data: YAML.parse(m[1]) || {}, body: m[2] };
}

export function sections(body) {
  const out = {};
  for (const part of body.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    out[part.slice(0, nl).trim().toLowerCase()] = part.slice(nl + 1).trim();
  }
  return out;
}

const bullets = (s = '') => s.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
const lines = (s = '') => s.split('\n').map((l) => l.trim()).filter(Boolean);

// ---------- loaders ----------
export function loadRequirements(src = diskSource()) {
  return src.list(`${CONTEXT_DIR}/requirements`)
    .filter((f) => /\/REQ-\d+\.md$/.test(f))
    .map((file) => {
      const { data, body } = parseFrontMatter(src.read(file));
      const s = sections(body);
      return {
        ...data,
        version: Number(data.version),
        affects: data.affects || [],
        file,
        rule: lines(s.rule),
        acceptance: bullets(s['acceptance criteria']),
        changelog: bullets(s.changelog),
      };
    })
    .sort(byId);
}

export function loadDecisions(src = diskSource()) {
  return src.list(`${CONTEXT_DIR}/decisions`)
    .filter((f) => /\/ADR-\d+\.md$/.test(f))
    .map((file) => {
      const { data, body } = parseFrontMatter(src.read(file));
      return { ...data, version: Number(data.version), requirements: data.requirements || [], file, body: body.trim() };
    })
    .sort(byId);
}

export function loadChangeRequests(src = diskSource()) {
  return src.list(`${CONTEXT_DIR}/change-requests`)
    .filter((f) => /\/CR-\d+\.md$/.test(f))
    .map((file) => {
      const { data, body } = parseFrontMatter(src.read(file));
      return { ...data, file, body: body.trim() };
    })
    .sort(byId);
}

export function loadPlan(src = diskSource()) {
  const file = `${CONTEXT_DIR}/plan/tasks.yaml`;
  if (!src.exists(file)) return [];
  const doc = YAML.parse(src.read(file)) || {};
  return (doc.tasks || []).map((t) => ({ ...t, implements: (t.implements || []).map(parseRef), depends_on: t.depends_on || [] }));
}

export function loadContract(src = diskSource()) {
  const file = `${CONTEXT_DIR}/contracts/openapi.yaml`;
  if (!src.exists(file)) return { doc: null, operations: [] };
  const doc = YAML.parse(src.read(file));
  const operations = [];
  for (const [path, item] of Object.entries(doc.paths || {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = item[method];
      if (!op) continue;
      operations.push({ method: method.toUpperCase(), path, operationId: op.operationId, summary: op.summary, requirements: op['x-requirements'], op });
    }
  }
  return { doc, operations };
}

// Acceptance tests are named after the requirement and declare the version they check:
//   apps/api/test/acceptance/REQ-004.test.js  →  describe('REQ-004@v1 Invite a user', …)
export function loadAcceptanceTests(src = diskSource()) {
  return src.list(ACCEPTANCE_DIR)
    .filter((f) => /\/REQ-\d+\.test\.[cm]?js$/.test(f))
    .map((file) => {
      const fileId = file.match(/(REQ-\d+)\.test/)[1];
      const m = src.read(file).match(/describe\(\s*['"`](REQ-\d+)@v(\d+)/);
      return { file, id: fileId, declaredId: m?.[1] ?? null, version: m ? Number(m[2]) : null };
    });
}

export function readManifest(src = diskSource()) {
  const file = `${CONTEXT_DIR}/manifest.json`;
  if (!src.exists(file)) return null;
  return JSON.parse(src.read(file));
}

// ---------- references ----------
export function parseRef(s) {
  const m = String(s).trim().match(/^(REQ-\d+)@v(\d+)$/i);
  if (!m) throw new Error(`Bad requirement reference "${s}" (expected REQ-xxx@vN)`);
  return { id: m[1].toUpperCase(), version: Number(m[2]) };
}

export function parseImplements(text) {
  return [...String(text ?? '').matchAll(/Implements:\s*([^\n]+)/gi)]
    .flatMap((m) => [...m[1].matchAll(/(REQ-\d+)@v(\d+)/gi)])
    .map((m) => ({ id: m[1].toUpperCase(), version: Number(m[2]) }));
}

export const fmtRef = (r) => `${r.id}@v${r.version}`;

// ---------- hashing and the manifest ----------
// Hash of every context file except the manifest itself.
export function contextHash(src = diskSource()) {
  const h = createHash('sha256');
  for (const f of src.list(CONTEXT_DIR).filter((f) => f !== `${CONTEXT_DIR}/manifest.json`).sort()) {
    h.update(f).update('\0').update(src.read(f).replace(/\r\n/g, '\n')).update('\0');
  }
  return h.digest('hex');
}

// Deterministic: no timestamps, so CI can check it is up to date.
export function computeManifest(src = diskSource(), previous = readManifest(src)) {
  const hash = contextHash(src);
  const reqs = loadRequirements(src);
  const contract = loadContract(src);
  const manifest = {
    contextVersion: previous ? previous.contextVersion + (previous.contentHash === hash ? 0 : 1) : 1,
    contentHash: hash,
    requirements: Object.fromEntries(reqs.filter((r) => r.status === 'approved').map((r) => [r.id, r.version])),
    deprecated: Object.fromEntries(reqs.filter((r) => ['deprecated', 'superseded'].includes(r.status)).map((r) => [r.id, r.version])),
    drafts: reqs.filter((r) => r.status === 'draft').map((r) => r.id),
    decisions: Object.fromEntries(loadDecisions(src).filter((d) => d.status === 'accepted').map((d) => [d.id, d.version])),
    contract: { version: contract.doc?.info?.version ?? null, operations: contract.operations.length },
    openChangeRequests: loadChangeRequests(src).filter((c) => c.status === 'draft').map((c) => c.id),
  };
  return manifest;
}

function byId(a, b) {
  return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
}

// ---------- small CLI helpers ----------
export function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

export function report({ errors = [], warnings = [], ok = [] }, title) {
  if (title) console.log(`\n${title}`);
  for (const m of ok) console.log(`  ✔ ${m}`);
  for (const m of warnings) console.log(`  ⚠ ${m}`);
  for (const m of errors) console.error(`  ✘ ${m}`);
  console.log(errors.length ? `\nFAILED: ${errors.length} error(s)` : `\nPASSED${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`);
  return errors.length ? 1 : 0;
}

// Changed files between two refs (for "context-only" pull requests).
export function changedFiles(base, head = 'HEAD', root = ROOT) {
  if (process.env.CHANGED_FILES) return process.env.CHANGED_FILES.split(/[\s,]+/).filter(Boolean);
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}
