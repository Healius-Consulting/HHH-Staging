# Platform threat model

## Protected assets

Patient and prescription data, payment state, pharmacy tenant data, staff identity and MFA state, integration secrets, audit records, and privileged actions are protected assets. Browser JavaScript is public material and must contain none of these assets or any environment secret.

## Trust boundaries

1. Untrusted browser to global load balancer and Cloud Armor.
2. Load balancer to Cloud Run ingress through serverless NEGs.
3. Protected web gateway to Firebase Authentication and `staffSessions`.
4. Browser to same-origin API using host-only cookies, App Check, CSRF, Origin, and Fetch Metadata.
5. API service to tenant-scoped repositories, Firestore, Storage, Worldpay, and Curaleaf.
6. Webhooks and scheduled reconciliation to authoritative payment/supplier state.

## Primary abuse cases and controls

| Abuse case | Preventive control | Detection / acceptance evidence |
|---|---|---|
| Request protected URL without using the UI | Gateway checks session before `index.html`; API independently checks session | Anonymous route matrix; synthetic redirect check |
| Call a `run.app` origin directly | Cloud Run LB-only ingress and disabled default URI | Infrastructure test from an external network |
| Reuse or alter a session | Signed/revocation-checked cookie plus hashed server registry, idle and absolute expiry | Tampered, expired, revoked, disabled-user tests |
| Cross-surface role use | Host-derived surface, exact role check, host-only cookie | Pharmacy-on-admin and admin-on-pharmacy tests |
| Cross-tenant record probing | Tenant derives from session; repositories require tenant; mismatch is `404` | Contract tests for every protected collection |
| Cross-site mutation | Strict SameSite, CSRF header/cookie, exact Origin/host, Fetch Metadata | Unsafe-method CSRF/origin matrix |
| Scripted public abuse | App Check, keyed limits, generic errors | Rejection metrics and rate-limit tests |
| Fake payment success URL | Opaque receipt token; hash-only storage; webhook/query state is authoritative | Return URL cannot mutate payment test |
| Shared-screen privacy leak | Secure Handover uses aggregate endpoint fields only | Zero-PII component and response assertions |
| Sensitive logging | Structured allowlist and keyed IP hashing | Log fixture scan and production sampling review |

## Residual risks and go-live blockers

Configuration drift, IAM mistakes, compromised staff endpoints, third-party outages, dependency vulnerabilities, and novel application flaws remain possible. Production data and payments are prohibited until the complete acceptance matrix, external penetration test, DPIA, incident/recovery exercise, audit-retention decision, and partner/regulatory approvals are complete.
