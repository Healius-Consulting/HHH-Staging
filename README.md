# Holistic Health Hub × Curaleaf Platform

React/TypeScript staff portal, public eligibility application and Firebase backend foundation for a multi-pharmacy medical-cannabis referral, payment, ordering and collection platform.

**Identity boundary:** HHH (Holistic Health Hub) is the platform/product name used by **Healius Consulting**. The exact registered legal entity behind that business name, company number and registered office are not yet confirmed and remain a mandatory pre-live compliance gate.

> Status: pre-production implementation. Firebase staff authentication, role/tenant guards, onboarding gates and backend adapters are implemented, but project credentials, external integration secrets, legal approvals and UAT are still required. Do not use real patient data until every go-live gate has passed.

## Prototype surfaces

- **HHH admin portal** — pharmacy onboarding, tenant branding/modules, cross-pharmacy patient attribution, platform integrations and a master compliance/evidence register.
- **Client / clinic portal** — tenant-isolated referral processing, patient CRM, prescription building, dual payment routing, supplier tracking and goods-in/collection.
- **Tokenised eligibility form** — a unique URL per pharmacy links every submission to the correct client.
- **Pharmacy resources** — copy the patient link, save a print-ready QR code, and generate a developer content-pack ZIP.
- **No patient account surface** — patients use the public eligibility form only; all authenticated access is staff-only.
- **Firebase API** — verified ID tokens, App Check, tenant-scoped repositories, audit logs, setup/preferences, private prescription files and server-only integration secrets.

## Run locally

```bash
npm install
npm run dev
```

To run the complete local flow, configure `.env` from `.env.example`, configure the API from `services/api/.env.example`, then use three terminals:

```bash
npm run dev:api
npm run dev:eligibility
npm run dev
```

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

Staff accounts are invite-only Firebase Authentication users. Assign either the `hhh_admin` role or the `pharmacy_staff` role with an `organisationId` custom claim and verify the email address before workspace access. TOTP support remains implemented but is disabled for staging by default; enable it later with `VITE_REQUIRE_MFA=true` on Vercel and `REQUIRE_MFA=true` on the API.

## Documentation

Start with [`specs/README.md`](specs/README.md). Important documents include:

- [`specs/production-architecture.md`](specs/production-architecture.md) — production topology, security, tenant isolation, integrations and onboarding.
- [`specs/separate-form-deployment.md`](specs/separate-form-deployment.md) — separate-domain form, shared API/database, environment variables and deployment outputs.
- [`specs/firebase-vercel-runbook.md`](specs/firebase-vercel-runbook.md) — the current Firebase/Vercel configuration and go-live checklist.
- [`specs/project-manager-playbook.md`](specs/project-manager-playbook.md) — pre-live and per-pharmacy delivery checklist.
- [`specs/uk-compliance-register.md`](specs/uk-compliance-register.md) — UK GDPR, ICO and GPhC requirements register.
- [`specs/Rocky-API-Reference.md`](specs/Rocky-API-Reference.md) — confirmed Rocky endpoints, schemas and corrections to earlier assumptions.
- `specs/Rocky_API_Technical_Requirements_v1.6.docx` — latest Curaleaf technical requirements document from `main`.

## Integration boundary

- Curaleaf Rocky is called only by the backend. HHH’s single API key is a Firebase Functions deployment secret; each pharmacy’s customer ID and portal email are stored separately in Secret Manager and never exposed to either Vercel application.
- Before a pharmacy has a verified Curaleaf customer ID, it receives a clearly labelled training workspace. The supplied dummy dataset returns after refresh, while all training edits stay in memory and are discarded on refresh/sign-out rather than written to Firebase.
- Curaleaf dispatch is not courier tracking. The platform records supplier dispatch, then the pharmacy records partial/full goods-in and separately confirms dispensing checks before collection notification.
- Worldpay must use hosted checkout, secure pharmacy merchant onboarding and verified server-side webhooks. The portal now models each pharmacy connection, but live onboarding/payment calls remain disabled until Worldpay approves the platform model and supplies credentials.
- Prescription scans require private UK-hosted storage, short-lived access links, retention rules and audit logging.
- The eligibility privacy notice and consent wording require solicitor/DPO approval before live use.

Prepared for Healius Consulting and its HHH platform.
