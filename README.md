# User Management — built on a centralized, versioned context

A real user-management app (accounts, roles, invitations, audit log, live directory) built the way the architecture
**"Keeping Every AI Agent Aligned with Client Needs"** describes:

- every client need is a **numbered, versioned requirement** in one `context/` folder;
- the context is **served to agents** through an MCP context server (ready for agents, usable today by people);
- when a need changes, an **impact analyzer** marks every linked task and pull request **stale** and alerts the team;
- **CI gates** refuse any pull request built on an outdated requirement version.

> The rule behind it all: **people approve, CI enforces, agents (later) only read and propose.**

---

## What is in the repository

```
context/                      ← the single source of truth (Component 2)
  AGENTS.md                   rules every developer and agent follows
  requirements/REQ-001…008.md one file per need: id, version, status, EARS rule, acceptance criteria, changelog
  change-requests/CR-001…002  client needs waiting for (or approved by) the product owner
  decisions/ADR-001…006.md    technical decisions and the rejected alternatives
  architecture/               C4 model (Structurizr DSL + Mermaid), data model, quality targets, threat model
  contracts/openapi.yaml      the API contract; every operation lists x-requirements
  plan/tasks.yaml             task plan; every task declares implements: [REQ-xxx@vN]
  glossary.md                 the client's vocabulary
  manifest.json               generated: context version + current version of every item
apps/api/                     Node.js 22 + Express + Socket.IO + SQLite
  test/acceptance/REQ-xxx.test.js   one acceptance test file per requirement, naming its version
apps/web/                     React 18 + Vite
tools/context-server/         MCP context server (Component 4) + live read-only viewer
scripts/context/              the gates and the impact analyzer — plain code, no AI (Components 5 and 6)
.github/                      workflows (CI gates, propagation, task guard, release), CODEOWNERS, templates
```

## How each part of the architecture is implemented

| Architecture component | Implemented by |
|---|---|
| 1. Capture | `.github/ISSUE_TEMPLATE/change-request.yml`, `context/change-requests/CR-xxx.md`, EARS check in `validate-context.mjs`, product-owner approval via `CODEOWNERS` |
| 2. Context repository | `context/` folder, `manifest.json` from `npm run context:manifest`, versioning rules enforced by `validate-context.mjs` (rule changed ⇒ version +1, nothing deleted) |
| 3. Architect outputs | `context/architecture/` (C4 in Structurizr DSL and Mermaid, data model, quality targets, threat model vs OWASP API Top 10), `decisions/`, `contracts/openapi.yaml`, `plan/tasks.yaml` |
| 4. Distribution | `tools/context-server`: MCP tools `get_task_context`, `get_context_version`, `get_requirement`, `get_decision`, `propose_change`, `propose_decision`, `report_assumption`; resources with `resources/subscribe` → `notifications/resources/updated`; every call logged with its version |
| 5. Change propagation | `scripts/context/impact.mjs` (query over trace links: plan, tests, contract, code, issues, PRs), `.github/workflows/context-propagation.yml` (labels `stale`, Slack/Teams webhook, task sync to Issues) |
| 6. Enforcement | `.github/workflows/context-gates.yml`: manifest check, context validation, **stale-context check**, **trace check**, Redocly lint, **Schemathesis contract tests**; `ci.yml`: acceptance tests; `task-guard.yml`: a stale task cannot be closed; branch protection via `scripts/github/protect-main.sh`; `release.yml` lists the context version |

| Tool from the document | Used here |
|---|---|
| AGENTS.md | `AGENTS.md`, `context/AGENTS.md` |
| Context repository in Git (GitHub) | `context/` |
| Architecture as code | `context/architecture/workspace.dsl` (Structurizr), `c4.md` (Mermaid) |
| OpenAPI + Redocly CLI | `context/contracts/openapi.yaml`, `redocly.yaml` (adds a rule: every operation must trace a requirement) |
| Context server (MCP, official TypeScript SDK) | `tools/context-server` (stdio and Streamable HTTP) |
| Impact analyzer | `scripts/context/impact.mjs` |
| Task board | GitHub Issues (`scripts/context/export-tasks.mjs`); Jira is a drop-in replacement |
| Notifications | Slack or Teams incoming webhooks (`SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL` secrets) |
| CI gates | GitHub Actions + branch protection + CODEOWNERS |
| Tests | Vitest (acceptance, one file per requirement), Schemathesis (contract) |

---

## Run it

Requirements: Node.js 22.13+ (Python 3 only for contract tests).

```bash
npm install
npm run dev              # API on http://localhost:3000, web on http://localhost:5173
npm run context:server   # context viewer + MCP on http://localhost:4000
```

Sign in at http://localhost:5173 with `admin@example.com` / `ChangeMe123!` (set `ADMIN_EMAIL` / `ADMIN_PASSWORD` to change).
Open a second browser as a manager to watch the directory update live.

With Docker: `docker compose up --build` → app on :3000, context server on :4000.

### Make it accessible to anyone
Deploy the `Dockerfile` (app) and `tools/context-server/Dockerfile` (context) to any container host (Render, Railway, Fly.io, a VPS).
Set `JWT_SECRET`, `ADMIN_PASSWORD` and `PUBLIC_URL`. The context viewer is read-only; set `CONTEXT_TOKEN` to protect `/mcp`.

### Turn on the gates on GitHub (once)
```bash
bash scripts/github/protect-main.sh OWNER/REPO   # required checks + code-owner reviews + labels
npm run context:export-tasks                      # with GITHUB_TOKEN and GITHUB_REPOSITORY: tasks → Issues
```
Optional secrets: `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`.

---

## Demo: the client changes their mind

`CR-002` is waiting in `context/change-requests/`: the client wants invitations to expire after **48 hours** instead of 72.

**1 — The product owner opens the change** (branch `cr-002`):
- edit `context/requirements/REQ-004.md`: `version: 2`, rule and acceptance criteria say 48 hours, add `- v2 (…): invitations valid for 48 hours (CR-002)` on top of the changelog;
- set `status: approved` in `CR-002.md`;
- `npm run context:manifest` → context version +1;
- open a pull request whose description says `Change-Request: CR-002`.

The **Context gates** job validates it, and posts the **impact report** on the pull request:
tasks `T-04`, `T-11`; test `REQ-004.test.js (checks v1)`; operations `POST /invitations`…
Forget to bump the version, or to regenerate the manifest, and the gate fails.

**2 — Merge (product owner approval required by CODEOWNERS).**
`context-propagation` labels the open task issues and pull requests built on `REQ-004@v1` **stale**, comments on them,
and sends a Slack/Teams message. Connected agents subscribed to `context://requirements/REQ-004` receive
`notifications/resources/updated`; `get_task_context("T-04")` now says `stale: true`.

**3 — A developer opens a pull request still saying `Implements: REQ-004@v1`** → **blocked**:
`REQ-004: built on v1, current is v2`. Closing the stale task issue reopens it.

**4 — QA rewrites the test first** (`describe('REQ-004@v2 …')`, `HOURS = 48`) → the test fails on the old code.
The developer changes `INVITATION_HOURS` to 48, the PR says `Implements: REQ-004@v2` → every gate is green → merge.

You can replay steps 1 and 3 locally without GitHub:
```bash
npm run test:scripts            # runs this exact scenario against a temporary git repo
PR_BODY="Implements: REQ-004@v1" npm run context:stale
```

---

## Connect an agent later

Any MCP client can read the context. Example configuration:

```json
{ "mcpServers": { "context": { "command": "node", "args": ["tools/context-server/src/index.js"] } } }
```
or remote: `{ "type": "http", "url": "https://your-host/mcp" }`.

The agent starts with `get_task_context("T-04")`, gets only that task's requirements, decisions, contract excerpt and rules,
stamped with the context version, and cannot merge outdated work because the gates check every pull request.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Acceptance tests (34), context-server tests, gate scenario tests |
| `npm run gates` | Manifest check, context validation, trace check, contract lint |
| `npm run context:manifest` | Regenerate `context/manifest.json` after editing `context/` |
| `npm run context:stale` | Stale-context check on `PR_BODY` |
| `npm run context:impact -- --base origin/main` | Impact report for the current branch |
| `npm run context:export-tasks` | Sync `plan/tasks.yaml` to GitHub Issues |
| `npm run context:server` | Context viewer + MCP over HTTP on :4000 |
