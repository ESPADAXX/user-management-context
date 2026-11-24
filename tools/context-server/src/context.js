// In-memory index of the context/ folder, rebuilt whenever a file changes.
// Every answer carries the context version it came from.
import { watch, mkdirSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import {
  ROOT, diskSource, loadRequirements, loadDecisions, loadPlan, loadContract, loadChangeRequests,
  computeManifest, readManifest, fmtRef,
} from '../../../scripts/context/lib.mjs';

export class ContextIndex extends EventEmitter {
  constructor({ root = process.env.CONTEXT_ROOT || ROOT, logDir } = {}) {
    super();
    this.root = root;
    this.logDir = logDir || join(root, '.context-logs');
    this.reload();
  }

  reload() {
    const src = diskSource(this.root);
    const previous = this.snapshot;
    // The committed manifest is the truth; if someone edits files locally without
    // regenerating it, compute it so answers stay consistent with the files.
    const committed = readManifest(src);
    const computed = computeManifest(src, committed);
    const manifest = committed && committed.contentHash === computed.contentHash ? committed : { ...computed, uncommitted: true };
    this.snapshot = {
      manifest,
      requirements: loadRequirements(src),
      decisions: loadDecisions(src),
      plan: loadPlan(src),
      contract: loadContract(src),
      changeRequests: loadChangeRequests(src),
      rules: src.exists('context/AGENTS.md') ? src.read('context/AGENTS.md') : '',
      glossary: src.exists('context/glossary.md') ? src.read('context/glossary.md') : '',
      quality: src.exists('context/architecture/quality-targets.md') ? src.read('context/architecture/quality-targets.md') : '',
      threats: src.exists('context/architecture/threat-model.md') ? src.read('context/architecture/threat-model.md') : '',
    };
    if (previous) {
      const changed = diffVersions(previous, this.snapshot);
      if (changed.requirements.length || changed.decisions.length || previous.manifest.contentHash !== manifest.contentHash) {
        this.emit('changed', { ...changed, contextVersion: manifest.contextVersion });
      }
    }
    return this.snapshot;
  }

  // Watches context/ and reloads (debounced). Returns a function that stops watching.
  watch() {
    let timer;
    const w = watch(join(this.root, 'context'), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { this.reload(); } catch (e) { console.error('[context] reload failed:', e.message); }
      }, 250);
    });
    return () => { clearTimeout(timer); w.close(); };
  }

  get version() { return this.snapshot.manifest.contextVersion; }

  // ---------- answers ----------
  contextVersion() {
    const m = this.snapshot.manifest;
    return { contextVersion: m.contextVersion, requirements: m.requirements, decisions: m.decisions, deprecated: m.deprecated, openChangeRequests: m.openChangeRequests, uncommitted: Boolean(m.uncommitted) };
  }

  requirement(id) {
    const r = this.snapshot.requirements.find((x) => x.id === id.toUpperCase());
    if (!r) return null;
    return { contextVersion: this.version, ...strip(r), history: this.history(r.file), pendingChangeRequests: this.snapshot.changeRequests.filter((c) => c.target === r.id && c.status === 'draft').map((c) => ({ id: c.id, body: c.body })) };
  }

  // Every committed version of a requirement file, from git (best effort).
  history(file) {
    try {
      const log = execFileSync('git', ['log', '--format=%H %as %an', '--', file], { cwd: this.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return log.trim().split('\n').filter(Boolean).map((l) => {
        const [commit, date, ...author] = l.split(' ');
        return { commit: commit.slice(0, 7), date, author: author.join(' ') };
      });
    } catch {
      return [];
    }
  }

  decision(id) {
    const d = this.snapshot.decisions.find((x) => x.id === id.toUpperCase());
    return d ? { contextVersion: this.version, ...strip(d) } : null;
  }

  // The task's slice: only what it needs, plus the global rules, stamped with versions.
  taskContext(taskId) {
    const s = this.snapshot;
    const task = s.plan.find((t) => t.id === taskId.toUpperCase());
    if (!task) return null;
    const ids = task.implements.map((r) => r.id);
    const requirements = task.implements.map((ref) => {
      const cur = s.requirements.find((r) => r.id === ref.id);
      const current = cur && cur.status === 'approved' ? cur.version : null;
      return {
        id: ref.id,
        plannedVersion: ref.version,
        currentVersion: current,
        status: cur?.status ?? 'missing',
        upToDate: current === ref.version,
        title: cur?.title,
        rule: cur?.rule,
        acceptance: cur?.acceptance,
        changelog: cur?.changelog,
        acceptanceTest: `apps/api/test/acceptance/${ref.id}.test.js`,
      };
    });
    const stale = requirements.filter((r) => !r.upToDate);
    return {
      contextVersion: this.version,
      task: { id: task.id, title: task.title, module: task.module, owner: task.owner, dependsOn: task.depends_on, implements: task.implements.map(fmtRef) },
      stale: stale.length > 0,
      staleReasons: stale.map((r) => (r.currentVersion ? `${r.id} is now v${r.currentVersion} (planned v${r.plannedVersion})` : `${r.id} is ${r.status}`)),
      pullRequestLine: `Implements: ${requirements.filter((r) => r.currentVersion).map((r) => `${r.id}@v${r.currentVersion}`).join(', ')}`,
      requirements,
      decisions: s.decisions.filter((d) => d.status === 'accepted' && d.requirements.some((r) => ids.includes(r))).map((d) => ({ id: d.id, version: d.version, title: d.title, body: d.body })),
      contract: s.contract.operations.filter((o) => (o.requirements || []).some((r) => ids.includes(r))).map((o) => ({ operation: `${o.method} ${o.path}`, operationId: o.operationId, summary: o.summary, requirements: o.requirements, spec: YAML.stringify(o.op) })),
      architecture: {
        qualityTargets: s.quality,
        threats: s.threats.split('\n').filter((l) => ids.some((id) => l.includes(id))),
      },
      glossary: s.glossary,
      rules: s.rules,
    };
  }

  overview() {
    const s = this.snapshot;
    return {
      manifest: this.contextVersion(),
      requirements: s.requirements.map((r) => ({ id: r.id, title: r.title, version: r.version, status: r.status, affects: r.affects })),
      decisions: s.decisions.map((d) => ({ id: d.id, title: d.title, version: d.version, status: d.status })),
      tasks: s.plan.map((t) => {
        const c = this.taskContext(t.id);
        return { id: t.id, title: t.title, module: t.module, owner: t.owner, implements: c.task.implements, stale: c.stale, staleReasons: c.staleReasons };
      }),
      changeRequests: s.changeRequests.map((c) => ({ id: c.id, target: c.target, status: c.status, source: c.source })),
    };
  }

  // ---------- proposals (agents propose, people approve) ----------
  async propose(kind, { text, requirementId, taskId, agent }) {
    const labels = { change: 'change-request', decision: 'decision-needed', assumption: 'assumption' };
    const titles = { change: 'Change request', decision: 'Decision needed', assumption: 'Assumption to review' };
    const body = [
      `**${titles[kind]}** proposed${agent ? ` by ${agent}` : ''} through the context server (context v${this.version}).`,
      requirementId ? `Requirement: ${requirementId}` : '',
      taskId ? `Task: ${taskId}` : '',
      '',
      text,
    ].filter((l) => l !== '').join('\n');
    this.log({ tool: `propose_${kind}`, args: { requirementId, taskId, agent } });

    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    if (token && repo && kind !== 'assumption') {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        body: JSON.stringify({ title: `[${titles[kind]}] ${text.split('\n')[0].slice(0, 80)}`, body, labels: [labels[kind]] }),
      });
      if (res.ok) {
        const issue = await res.json();
        return { status: 'opened', where: issue.html_url, note: `Waiting for ${kind === 'change' ? 'the product owner' : 'the tech lead'}. Do not implement it until it is approved.` };
      }
    }
    const dir = join(this.root, '.context-inbox');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}.md`);
    writeFileSync(file, `---\nkind: ${kind}\ncontextVersion: ${this.version}\n---\n${body}\n`);
    return { status: 'queued', where: file, note: kind === 'assumption' ? 'Logged for human review.' : 'Queued locally (set GITHUB_TOKEN and GITHUB_REPOSITORY to open an issue). Do not implement it until it is approved.' };
  }

  // Every call is logged with the version it returned, so you can see who read what, when.
  log(entry) {
    try {
      if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
      appendFileSync(join(this.logDir, 'calls.jsonl'), JSON.stringify({ ts: new Date().toISOString(), contextVersion: this.version, ...entry }) + '\n');
    } catch { /* logging never breaks an answer */ }
  }
}

function strip(x) {
  const { file, ...rest } = x;
  return { ...rest, file };
}

function diffVersions(a, b) {
  const map = (list) => new Map(list.map((x) => [x.id, `${x.version}:${x.status}`]));
  const diff = (oldList, newList) => {
    const o = map(oldList);
    return newList.filter((x) => o.get(x.id) !== `${x.version}:${x.status}`).map((x) => x.id);
  };
  return { requirements: diff(a.requirements, b.requirements), decisions: diff(a.decisions, b.decisions) };
}
