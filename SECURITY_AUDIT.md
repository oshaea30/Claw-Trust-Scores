# Security Audit Report

Date: 2026-02-16
Scope: `/Users/oshaealexis/Documents/New project/agent-trust-registry`
Auditor: Codex (GPT-5)

## Executive Summary

Current release is materially stronger after hardening and passes all local security-focused tests.  
There are no known critical remote code execution paths in current code.  
Residual risk remains around single-node architecture and file-based secret storage.

Status:
- Unit + system tests: 12/12 passing
- Security regression tests: passing
- Dependency audit: low exposure (no third-party runtime deps)

## Findings (Ordered by Severity)

### [Fixed] P1 - Webhook SSRF risk via arbitrary callback URL

- File: `/Users/oshaealexis/Documents/New project/agent-trust-registry/src/webhooks.js`
- Issue: Webhook creation previously accepted any http/https target, including localhost/private addresses.
- Risk: Could be abused to probe internal services or metadata endpoints from server network.
- Fix implemented:
  - Reject localhost and local/internal hostnames
  - Reject private/link-local IP ranges (IPv4 + IPv6)
  - Require public http/https URL
- Verification:
  - Test: `/Users/oshaealexis/Documents/New project/agent-trust-registry/test/security.test.js`
  - Case validates localhost/private rejection and public acceptance.

### [Fixed] P1 - Production fallback to demo API keys

- File: `/Users/oshaealexis/Documents/New project/agent-trust-registry/src/auth.js`
- Issue: Service previously defaulted to demo keys even when misconfigured in production.
- Risk: Unauthorized access if production launched without explicit keys.
- Fix implemented:
  - In `NODE_ENV=production`, service requires explicit `TRUST_API_KEYS` (no demo fallback).
- Verification:
  - Test: `/Users/oshaealexis/Documents/New project/agent-trust-registry/test/security.test.js`

### [Fixed] P2 - Information disclosure in health endpoint

- File: `/Users/oshaealexis/Documents/New project/agent-trust-registry/src/server.js`
- Issue: `/health` returned absolute persistence path.
- Risk: Unnecessary infrastructure/path disclosure.
- Fix implemented:
  - Removed filesystem path from health response.

### [Fixed] P2 - Missing baseline API hardening headers

- File: `/Users/oshaealexis/Documents/New project/agent-trust-registry/src/server.js`
- Issue: Responses lacked defensive headers.
- Fix implemented:
  - Added `Cache-Control: no-store`
  - Added `X-Content-Type-Options: nosniff`
  - Added `X-Frame-Options: DENY`
  - Added `Referrer-Policy: no-referrer`
  - Added restrictive `Content-Security-Policy`

### [Fixed] P3 - Request body size accounting inefficiency

- File: `/Users/oshaealexis/Documents/New project/agent-trust-registry/src/server.js`
- Issue: Body size was recomputed each chunk using array reduce.
- Risk: Avoidable CPU overhead during large-body attempts.
- Fix implemented:
  - Incremental byte counter per chunk.

## Residual Risks / Not Yet Fully Addressed

### [Open] P2 - Secrets are persisted in plaintext state file

- Files:
  - `/Users/oshaealexis/Documents/New project/agent-trust-registry/src/persistence.js`
  - `/Users/oshaealexis/Documents/New project/agent-trust-registry/src/store.js`
- Detail: Webhook secrets are stored in local JSON state file.
- Recommendation:
  - Move to encrypted storage or DB secret vault model.
  - Tighten filesystem permissions on runtime volume.

### [Open] P2 - Single-instance in-memory rate limiting

- File: `/Users/oshaealexis/Documents/New project/agent-trust-registry/src/service.js`
- Detail: Rate limits are process-local and may be bypassed in multi-instance deployments.
- Recommendation:
  - Move rate limiting and counters to shared backend (Redis/Postgres).

### [Open] P3 - No automated key rotation API/UI

- Detail: API key lifecycle is env-var managed only.
- Recommendation:
  - Add admin key issuance/rotation/revocation workflow.

## Security Test Coverage Added

- `/Users/oshaealexis/Documents/New project/agent-trust-registry/test/security.test.js`
  - production requires explicit keys
  - dev key fallback works only for local/dev
  - webhook private/local URL blocking

- `/Users/oshaealexis/Documents/New project/agent-trust-registry/test/system.test.js`
  - quota enforcement + upgrade guidance
  - persistence reload verification
  - webhook downward-threshold trigger behavior
  - webhook signature correctness

## Reproducible Audit Commands

```bash
cd "/Users/oshaealexis/Documents/New project/agent-trust-registry"
npm test
npm audit --omit=dev
```

## Security Deployment Checklist (Railway)

1. Set `NODE_ENV=production`
2. Set strong `TRUST_API_KEYS` (no demo keys)
3. Use persistent volume for `DATA_DIR`
4. Restrict dashboard/project access via least privilege
5. Rotate API keys periodically
6. Monitor webhook delivery failures and unusual event spikes
7. Plan migration from JSON state to DB + shared rate limiting

