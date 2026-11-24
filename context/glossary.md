# Glossary

Use these words, exactly, in code, tests, the UI and pull requests.

| Term | Meaning |
|---|---|
| User / account | A person who can sign in. Has one email, one name, one role and one status. |
| Role | `admin`, `manager` or `member`. Exactly one per user (REQ-003). |
| Admin | Manages accounts, roles, invitations and reads the audit log. |
| Manager | Reads and searches the directory and receives live updates; changes nothing. |
| Member | Sees only their own profile. |
| Status | `active` or `inactive`. Inactive users cannot sign in (REQ-005). |
| Deactivate | Set a user inactive and revoke every token they hold. Never deletes the user. |
| Invitation | A single-use link that lets someone create their own account with a given role (REQ-004). |
| Directory | The searchable list of users (REQ-008), updated live (REQ-007). |
| Audit event | An immutable record of who changed what, on whom, and when (REQ-006). |
| Lock | A temporary block on sign-in for one email after repeated failures (REQ-002). |
