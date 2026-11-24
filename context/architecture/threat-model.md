# Threat model (OWASP API Security Top 10, 2023)

| Endpoint | Threat | OWASP | Mitigation | Requirement |
|---|---|---|---|---|
| POST /auth/login | Password guessing | API2 Broken authentication | Lock after 5 failures in 15 min; same message for unknown email and wrong password | REQ-002 |
| Every authenticated route | Token kept after deactivation | API2 | Token version checked on every request | REQ-005 |
| GET /users/{id} | Reading another user's profile | API1 Broken object level authorization | Members may read only their own id | REQ-003 |
| PUT /users/{id}/role | Member or manager escalating a role | API5 Broken function level authorization | Admin only; last admin cannot be demoted | REQ-003 |
| POST /users, PATCH /users/{id} | Mass assignment (`role`, `status`, `password_hash` in body) | API3 Broken object property level authorization | Strict schemas; unknown fields rejected (422); PATCH accepts `name` only | REQ-001 |
| GET /users | Scraping the whole directory | API4 Unrestricted resource consumption | pageSize ≤ 100; JSON body ≤ 100 kB | REQ-008 |
| POST /invitations/{token}/accept | Guessing or reusing a token | API2 | 256-bit random token, single use, expires | REQ-004 |
| GET /audit-events | Tampering with history | API5 | No update/delete route; admin-only read | REQ-006 |
| Socket.IO | Members receiving directory data | API1 | Token checked at handshake; only admins and managers join the room | REQ-007 |
| All | Leaking stack traces | API8 Security misconfiguration | problem+json errors without internals; `x-powered-by` disabled | ADR-003 |
