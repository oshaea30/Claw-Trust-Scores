# Launch Smoke Report

Date: February 19, 2026  
Environment: Local verification against current code (`node src/server.js`)  

## Scope

This smoke pass validated:

- Clean docs/legal/status routes without `.html`
- Redirect behavior from legacy `.html` routes
- Core public endpoints
- Basic auth behavior for protected endpoints
- Signup flow response
- Test suite health

## Results

### Route and page checks

- `GET /` -> `200` PASS
- `GET /api-docs` -> `200` PASS
- `GET /getting-started` -> `200` PASS
- `GET /terms` -> `200` PASS
- `GET /privacy` -> `200` PASS
- `GET /status` -> `200` PASS
- `GET /changelog` -> `200` PASS
- `GET /api-docs.html` -> `308` PASS (redirects to `/api-docs`)

### API checks

- `GET /health` -> `200` PASS
- `GET /v1/plans` -> `200` PASS
- `POST /v1/users` (valid email) -> `201` PASS
- `GET /v1/score` without API key -> `401` PASS
- `GET /v1/usage` with `demo_free_key` -> `200` PASS
- `GET /v1/score?agentId=agent:smoke:1` with `demo_free_key` -> `200` PASS

### Automated tests

- `npm test` -> PASS
- Summary: `22 passed, 0 failed`

## Notes

- Clean URL aliases are live in routing for:
  - `/api-docs`
  - `/getting-started`
  - `/privacy`
  - `/terms`
  - `/status`
  - `/changelog`
- Legacy `.html` routes redirect to clean URLs.
- Canonical and core social meta tags were added across all public pages for consistency.
- Footer now includes: `Powered by Collocate`.
