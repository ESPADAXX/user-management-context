// Tests the context gates on a throwaway copy of the repo with real git history:
// a client change (CR-002: invitations 72 h → 48 h) goes through every gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../lib.mjs';

let dir;
const sh = (cmd, args, env = {}) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
const node = (script, args = [], env = {}) => sh('node', [join(dir, 'scripts/context', script), ...args], env);
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
const edit = (file, fn) => writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), 'utf8')));

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ctx-gates-'));
  for (const p of ['context', 'scripts', 'apps/api/test/acceptance', 'apps/api/src', 'apps/web/src', 'package.json']) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    cpSync(join(ROOT, p), join(dir, p), { recursive: true, filter: (s) => !s.includes('node_modules') });
  }
  // the scripts import "yaml": point to the real node_modules
  execFileSync('ln', ['-s', join(ROOT, 'node_modules'), join(dir, 'node_modules')]);
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('the committed context passes every gate', () => {
  assert.equal(node('build-manifest.mjs', ['--check']).status, 0);
  assert.equal(node('validate-context.mjs', ['--base', 'main']).status, 0);
  assert.equal(node('check-trace.mjs').status, 0);
});

test('changing a rule without bumping the version is refused', () => {
  git('checkout', '-q', '-b', 'cr-002-no-bump');
  edit('context/requirements/REQ-004.md', (s) => s.replace('valid for 72 hours', 'valid for 48 hours'));
  const r = node('validate-context.mjs', ['--base', 'main']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /REQ-004: rule or acceptance criteria changed, so the version must go from v1 to v2/);
  git('checkout', '-q', '.');
  git('checkout', '-q', 'main');
});

test('a correct change request passes; manifest must be regenerated; impact lists what to update', () => {
  git('checkout', '-q', '-b', 'cr-002');
  edit('context/requirements/REQ-004.md', (s) => s
    .replace('version: 1', 'version: 2')
    .replace('valid for 72 hours', 'valid for 48 hours')
    .replace('expiring 72 hours later', 'expiring 48 hours later')
    .replace('or after 72 hours', 'or after 48 hours')
    .replace('## Changelog\n', '## Changelog\n- v2 (2026-11-24): invitations valid for 48 hours (CR-002)\n'));
  edit('context/change-requests/CR-002.md', (s) => s.replace('status: draft', 'status: approved'));

  assert.equal(node('build-manifest.mjs', ['--check']).status, 1, 'stale manifest must fail');
  const before = JSON.parse(readFileSync(join(dir, 'context/manifest.json'), 'utf8')).contextVersion;
  assert.equal(node('build-manifest.mjs').status, 0);
  const m = JSON.parse(readFileSync(join(dir, 'context/manifest.json'), 'utf8'));
  assert.equal(m.contextVersion, before + 1);
  assert.equal(m.requirements['REQ-004'], 2);

  assert.equal(node('validate-context.mjs', ['--base', 'main']).status, 0);
  // context-only PR: lagging tests are a warning, not an error
  const trace = node('check-trace.mjs', ['--base', 'main'], { CHANGED_FILES: 'context/requirements/REQ-004.md context/manifest.json' });
  assert.equal(trace.status, 0);
  assert.match(trace.stdout, /REQ-004\.test\.js checks REQ-004@v1, but the requirement is v2/);
  const cr = node('check-context.mjs', ['--base', 'main'], { PR_BODY: 'Change-Request: CR-002', CHANGED_FILES: 'context/requirements/REQ-004.md' });
  assert.equal(cr.status, 0);

  const impact = node('impact.mjs', ['--base', 'main']);
  assert.equal(impact.status, 0);
  assert.match(impact.stdout, /\*\*REQ-004\*\* v1 → v2/);
  assert.match(impact.stdout, /Plan tasks to re-plan: T-04, T-11/);
  assert.match(impact.stdout, /Acceptance tests to rewrite first: apps\/api\/test\/acceptance\/REQ-004\.test\.js \(checks v1\)/);
  assert.match(impact.stdout, /POST \/invitations/);
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'CR-002');
  git('checkout', '-q', 'main');
  git('merge', '-q', 'cr-002');
});

test('after the change, code PRs on the old version are blocked until tests and code catch up', () => {
  const codeFiles = { CHANGED_FILES: 'apps/api/src/routes/invitations.js' };
  const old = node('check-context.mjs', [], { PR_BODY: 'Implements: REQ-004@v1', ...codeFiles });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /REQ-004: built on v1, current is v2/);

  const trace = node('check-trace.mjs', ['--base', 'HEAD~1'], codeFiles);
  assert.equal(trace.status, 1, 'tests still on v1 must block code PRs');

  edit('apps/api/test/acceptance/REQ-004.test.js', (s) => s.replace('REQ-004@v1', 'REQ-004@v2'));
  assert.equal(node('check-trace.mjs').status, 0);
  assert.equal(node('check-context.mjs', [], { PR_BODY: 'Implements: REQ-004@v2', ...codeFiles }).status, 0);
});

test('a PR with no Implements line is refused unless it is a chore outside apps/', () => {
  assert.equal(node('check-context.mjs', ['--base', 'main'], { PR_BODY: 'fix stuff', CHANGED_FILES: 'apps/api/src/app.js' }).status, 1);
  assert.equal(node('check-context.mjs', ['--base', 'main'], { PR_BODY: 'Chore: bump CI', CHANGED_FILES: '.github/workflows/ci.yml' }).status, 0);
  assert.equal(node('check-context.mjs', ['--base', 'main'], { PR_BODY: 'Chore: sneaky', CHANGED_FILES: 'apps/api/src/app.js' }).status, 1);
});

test('deleting a requirement is refused', () => {
  git('checkout', '-q', '-b', 'delete');
  rmSync(join(dir, 'context/requirements/REQ-008.md'));
  const r = node('validate-context.mjs', ['--base', 'main']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /REQ-008 was deleted/);
  git('checkout', '-q', '.');
  git('checkout', '-q', 'main');
});
