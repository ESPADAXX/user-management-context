# Quality targets

| Target | Value | Checked by |
|---|---|---|
| API latency | p95 < 200 ms for every endpoint at 50 requests/s | Load test before release |
| Live update delay | Directory events delivered < 2 s (REQ-007) | Acceptance test REQ-007 |
| Availability | 99.5 % per month | Uptime monitor |
| Security | No high finding against the OWASP API Top 10 (see threat-model.md) | Review + contract tests |
| Contract drift | 0 differences between the running API and `contracts/openapi.yaml` | Schemathesis in CI |
| Traceability | Every approved requirement has a task and an acceptance test | `check-trace` gate |
