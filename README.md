# Holistic Health Hub × Curaleaf Platform

React/TypeScript staff portal, public eligibility application and Firebase backend foundation for a multi-pharmacy medical-cannabis referral, payment, ordering and collection platform.

**Identity boundary:** HHH (Holistic Health Hub) is the platform/product name used by **Healius Consulting**. The exact registered legal entity behind that business name, company number and registered office are not yet confirmed and remain a mandatory pre-live compliance gate.

> Status: pre-production implementation. Firebase staff authentication, role/tenant guards, onboarding gates and backend adapters are implemented, but project credentials, external integration secrets, legal approvals and UAT are still required. Do not use real patient data until every go-live gate has passed.

## Prototype surfaces

- **Combined staff portal** — one authenticated origin with HHH administration under `/admin/...` and tenant-isolated pharmacy workspaces under `/pharmacy/...`.
- **Tokenised eligibility form** — a unique URL per pharmacy links every submission to the correct client.
- **Pharmacy resources** — copy the patient link, save a print-ready QR code, and generate a developer content-pack ZIP.
- **No patient account surface** — patients use the public eligibility form only; all authenticated access is staff-only.
- **Firebase API** — verified ID tokens, App Check, tenant-scoped repositories, audit logs, setup/preferences, private prescription files and server-only integration secrets.

## Run locally

```bash
npm install
npm run dev
```

To run the combined portal locally against its configured API, link the repository to the portal Vercel project, configure `.env` from `.env.example`, then run:

```bash
npm run dev
```

The internal `dev:pharmacy` and `dev:admin` commands exist only for isolated bundle development; they still use `/pharmacy/...` and `/admin/...` and are not separate deployment surfaces. Run `dev:api` and `dev:eligibility` separately only when working on those services.

When the Firebase web configuration is absent, the staff portal stays locked instead of exposing a demo password. Production builds never include seeded patients or orders.

Production build and checks:

```bash
npm run build
npm run lint
npm run build:all
```

Use the gateway shown at `http://localhost:5173`. The separately hosted pharmacy eligibility link follows this pattern:

```text
http://localhost:5174/?token=<pharmacy-referral-token>
```

Staff accounts are invite-only Firebase Authentication users. Assign either the `hhh_admin` role or the `pharmacy_staff` role with an `organisationId` custom claim and verify the email address before workspace access. Cookie-mode pharmacy and admin builds require TOTP and the deployed API must set `REQUIRE_MFA=true`; there is no shared staging bypass.

## Documentation

Start with [`specs/README.md`](specs/README.md). Important documents include:

- [`specs/production-architecture.md`](specs/production-architecture.md) — production topology, security, tenant isolation, integrations and onboarding.
- [`specs/separate-form-deployment.md`](specs/separate-form-deployment.md) — separate-domain form, shared API/database, environment variables and deployment outputs.
- [`specs/firebase-vercel-runbook.md`](specs/firebase-vercel-runbook.md) — the current Firebase/Vercel configuration and go-live checklist.
- [`specs/sql-connect-backend-rewrite.md`](specs/sql-connect-backend-rewrite.md) — the relational redesign, security boundary and staged Firestore migration plan.
- [`services/api-sql/README.md`](services/api-sql/README.md) — the isolated API rewrite workspace, implementation plan and route-by-route SQL cutover matrix.
- [`specs/project-manager-playbook.md`](specs/project-manager-playbook.md) — pre-live and per-pharmacy delivery checklist.
- [`specs/uk-compliance-register.md`](specs/uk-compliance-register.md) — UK GDPR, ICO and GPhC requirements register.
- [`specs/Rocky-API-Reference.md`](specs/Rocky-API-Reference.md) — confirmed Rocky endpoints, schemas and corrections to earlier assumptions.
- `specs/Rocky_API_Technical_Requirements_v1.6.docx` — latest Curaleaf technical requirements document from `main`.

## Integration boundary

- Curaleaf Rocky is called only by the backend. HHH’s single API key is a Firebase Functions deployment secret; each pharmacy’s customer ID and portal email are stored separately in Secret Manager and never exposed to either Vercel application.
- Before a pharmacy has a verified Curaleaf customer ID, it receives a clearly labelled training workspace. The supplied dummy dataset returns after refresh, while all training edits stay in memory and are discarded on refresh/sign-out rather than written to Firebase.
- Curaleaf dispatch is not courier tracking. The platform records supplier dispatch, then the pharmacy records partial/full goods-in and separately confirms dispensing checks before collection notification.
- Worldpay uses the WPeCommerce Hosted Payment Pages API with one server-side merchant connection per pharmacy. Webhooks are acknowledged without an invented shared secret; HHH independently verifies the transaction reference, amount, currency, entity and settlement state through Payment Queries before marking an order paid. TRY UAT and Worldpay approval remain pre-live gates.
- Prescription scans require private UK-hosted storage, short-lived access links, retention rules and audit logging.
- The eligibility privacy notice and consent wording require solicitor/DPO approval before live use.

Prepared for Healius Consulting and its HHH platform.
