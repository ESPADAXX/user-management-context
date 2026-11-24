# Context rules (every developer and every agent)

This folder is the single source of truth for the user-management app.
People approve it; CI enforces it; agents only read it and propose changes.

## Rules
- Start of a task: call `get_task_context(taskId)` on the context server (or read the task's requirements here) and work only from what it returns.
- Before a pull request: call `get_context_version()`; if anything changed since you started, re-read your task context.
- Every pull request lists `Implements: REQ-xxx@vN` for each requirement it touches.
- Acceptance tests live in `apps/api/test/acceptance/REQ-xxx.test.js` and name the version they check: `describe('REQ-xxx@vN …')`.
- Every API operation in `contracts/openapi.yaml` lists `x-requirements`.
- A need the context doesn't cover: call `propose_change`; never invent the rule.
- A choice no ADR covers: call `propose_decision` and wait for the tech lead.
- An assumption you had to make: call `report_assumption`.
- Never edit files under `context/` in a code pull request. Context changes go through a change request reviewed by its owner (see `.github/CODEOWNERS`).
- Only `approved` requirements and `accepted` decisions count. Ignore `draft`, `proposed`, `deprecated` and `superseded` items.

## Folder map
| Path | What | Owner |
|---|---|---|
| `requirements/REQ-xxx.md` | One need: id, version, status, EARS rule, acceptance criteria, changelog | Product owner |
| `change-requests/CR-xxx.md` | A client need waiting for approval, quoting the client | Product owner |
| `decisions/ADR-xxx.md` | One technical decision and the rejected options | Tech lead |
| `architecture/` | C4 model (Structurizr DSL + Mermaid), data model, quality targets, threat model | Tech lead |
| `contracts/openapi.yaml` | The API contract; each operation lists `x-requirements` | Tech lead |
| `plan/tasks.yaml` | Task plan; each task declares `implements: [REQ-xxx@vN]` | Tech lead |
| `glossary.md` | The client's vocabulary | Product owner |
| `manifest.json` | Generated: context version + current version of every item | Nobody (script) |

## Versioning
- A requirement's version goes up when its rule or acceptance criteria change; a typo fix does not.
- Status: `draft → approved → deprecated | superseded`.
- The context version goes up on every merged change to this folder (`npm run context:manifest`).
- Nothing is deleted: superseded files stay, so the history explains the code.
