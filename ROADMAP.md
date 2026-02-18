# Claw Trust Scores Roadmap (Next 30 Days)

## Goal
Become policy-critical infrastructure in agent workflows, not just a score API.

## Week 1 - Integration Distribution
- Ship and document two first-class integrations:
  - ClawCredit preflight policy
  - One general agent framework adapter
- Success metric:
  - 2 production integrations that call trust checks before risky actions

## Week 2 - Compliance Wedge
- Complete and launch decision audit logging/export in customer workflows.
- Add downloadable JSON/CSV exports in docs + examples.
- Success metric:
  - at least 2 customers using audit export for internal review

## Week 3 - Anti-Gaming Signal Quality v1
- Add source-level trust weighting for event emitters.
- Add burst suppression flags for suspicious negative/positive spam.
- Expose confidence score in responses.
- Success metric:
  - measurable reduction in event-manipulation edge cases

## Week 4 - ROI Proof
- Publish 2 short case studies with hard numbers:
  - manual-review reduction
  - incident prevention outcomes
- Add outcome-focused landing section with real metrics.
- Success metric:
  - first repeatable conversion narrative

## Product Principles
- One trust check call should be enough to enforce policy.
- Every block/review decision must be explainable and exportable.
- Free tier stays intentionally tight to force production upgrades.

## Immediate Backlog (Priority Order)
1. Shared-rate-limit backend (Redis/Postgres) for multi-instance integrity.
2. Encrypt webhook secrets at rest.
3. Admin key rotation/revocation endpoint.
4. Framework SDK snippets for TypeScript/Python.
5. Usage dashboard endpoint (`/v1/usage`) for billing UX.
