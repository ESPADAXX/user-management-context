# AGENTS.md

Instructions for any coding agent (and any developer) working in this repository.

**Read `context/AGENTS.md` first.** It holds the context rules every agent follows.
The short version:

1. Start each task with `get_task_context(taskId)` from the context server and work only from it.
2. Before opening a pull request, call `get_context_version()`; re-read the task if anything changed.
3. Every pull request declares `Implements: REQ-xxx@vN`.
4. Never edit `context/` in a code pull request. Never invent a rule: `propose_change` / `propose_decision`.

## Connect to the context server
Local (stdio): `node tools/context-server/src/index.js`
Remote (HTTP): `npm run context:server` then `http://localhost:4000/mcp`

## Commands
| Task | Command |
|---|---|
| Install | `npm install` |
| Run API + web | `npm run dev` (API :3000, web :5173) |
| All tests | `npm test` |
| One requirement's acceptance test | `npx -w apps/api vitest run test/acceptance/REQ-004.test.js` |
| All context gates | `npm run gates` |
| Check a PR description | `PR_BODY="Implements: REQ-004@v1" npm run context:stale` |

## Code conventions
- API: Express routers in `apps/api/src/routes/`, input validated with zod, errors as problem+json (ADR-003).
- Comment the requirement a block serves: `// REQ-004: …`. The trace gate checks these references.
- Web: React function components in `apps/web/src/pages/`.
