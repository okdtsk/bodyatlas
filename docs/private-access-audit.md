# Private account access and security audit

Set the `ALLOWED_EMAILS` secret to the owner's exact Google account email. The comma-separated list supports future explicit changes. Missing configuration fails closed outside `ENVIRONMENT=development`. Google callbacks, existing API sessions, native session handoff, OAuth consent, and every MCP tool invocation check current user eligibility. A previously issued OAuth token or an already-open MCP connection does not bypass a revoked account.

The iOS shell loads the public HTML/JavaScript at the live site. Keep these static resources and the OAuth discovery/registration/token endpoints available to preserve existing native and MCP protocols. Personal data remains behind authentication plus the account allowlist, across custom domains and workers.dev. Preview URLs stay disabled. Adding Cloudflare Access to all HTML requires a separate native authentication design and real-device verification.

Apply `worker/migrations/0011_security_audit.sql` before deploying. The migration is additive and idempotent; its table/index creation was also applied directly to production. Running Wrangler migrations later remains safe. The CI E2E fixture explicitly allows its test account; local developers must set an appropriate local allowlist or explicitly use `ENVIRONMENT=development` in `.dev.vars`.

`security_audit_events` stores time, actor ID (or NULL), read/write/export/auth/MCP classification, fixed category/tool name, and result status. It excludes raw URLs/queries, record IDs from paths, request/response bodies, tool arguments/results, cookies, and API keys. MCP tool protocol errors are represented by status 400, permission denials by 403, and unexpected execution errors by 500. The daily cron removes entries older than 365 days.

An audit write failure emits only `security_audit_write_failed` and does not fail the user action. Validation failures rejected by the MCP SDK before invoking a tool are outside the tool wrapper. This database is application audit history, not a tamper-proof external archive. Cloudflare Access-denied traffic and OAuth provider endpoints require their own platform logs.

Use a current Wrangler supporting `observability.redact_query_string`; older project CLI versions ignore it. Vite-generated configs can contain deprecated `legacy_env`; remove that field when deploying through current Wrangler. Verify the live redaction setting after every deployment. Historic platform logs are not retroactively redacted.

```sql
SELECT datetime(occurred_at / 1000, 'unixepoch') AS time_utc,
       actor_id, action, category, operation, status
FROM security_audit_events
ORDER BY occurred_at DESC LIMIT 200;
```

After deployment verify anonymous API=401, valid outsider session=403, owner web login, native handoff, MCP OAuth plus an actual tool call, and corresponding audit entries. Unit/integration tests do not establish that an actual iOS device or external connector has completed its login.
