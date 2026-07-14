# Holistic Health Hub × Curaleaf Platform

Interactive React/TypeScript prototype and technical specification for a multi-pharmacy medical-cannabis referral, payment, ordering and collection platform.

**Identity boundary:** HHH (Holistic Health Hub) is the platform/product name used by **Healius Consulting**. The exact registered legal entity behind that business name, company number and registered office are not yet confirmed and remain a mandatory pre-live compliance gate.

> Status: functional prototype only. Data is in-memory and authentication is simulated. Curaleaf sandbox read connectivity is available through the API service; supplier write operations and Worldpay are not live. Do not use real patient data.

## Prototype surfaces

- **HHH admin portal** — pharmacy onboarding, tenant branding/modules, cross-pharmacy patient attribution, platform integrations and a master compliance/evidence register.
- **Client / clinic portal** — tenant-isolated referral processing, patient CRM, prescription building, dual payment routing, supplier tracking and goods-in/collection.
- **Tokenised eligibility form** — a unique URL per pharmacy links every submission to the correct client.
- **Pharmacy resources** — copy the patient link, save a print-ready QR code, and generate a developer content-pack ZIP.
- **Patient portal** — simulated payment, prescription tracking, collection pass, repeats and appointment requests.

## Run locally

```bash
npm install
npm run dev
```

To run the complete local flow, use three terminals:

```bash
npm run dev:api
npm run dev:eligibility
npm run dev
```

The development API uses safe in-memory seed data when `DATABASE_URL` is not set, so PostgreSQL is not required for the local prototype. Configure `DATABASE_URL` before production or persistent staging use.

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

Development staff login accounts:

| Role | Email | Password | Destination |
|---|---|---|---|
| HHH admin | `admin@hhh.health` | `AdminDemo2026!` | All-pharmacy admin portal |
| Leeds pharmacy | `leeds@hhh.health` | `PharmacyDemo2026!` | HHH Leeds client portal |
| Lincoln pharmacy | `lincoln@hhh.health` | `PharmacyDemo2026!` | East Midlands client portal |

These are browser-side prototype accounts only. Replace them with server-side staff authentication and MFA before staging with real users.

## Documentation

Start with [`specs/README.md`](specs/README.md). Important documents include:

- [`specs/production-architecture.md`](specs/production-architecture.md) — production topology, security, tenant isolation, integrations and onboarding.
- [`specs/separate-form-deployment.md`](specs/separate-form-deployment.md) — separate-domain form, shared API/database, environment variables and deployment outputs.
- [`specs/project-manager-playbook.md`](specs/project-manager-playbook.md) — pre-live and per-pharmacy delivery checklist.
- [`specs/uk-compliance-register.md`](specs/uk-compliance-register.md) — UK GDPR, ICO and GPhC requirements register.
- [`specs/Rocky-API-Reference.md`](specs/Rocky-API-Reference.md) — confirmed Rocky endpoints, schemas and corrections to earlier assumptions.
- `specs/Rocky_API_Technical_Requirements_v1.6.docx` — latest Curaleaf technical requirements document from `main`.

## Integration boundary

- Curaleaf Rocky must be called by a secure backend with per-pharmacy credentials stored in a secrets manager; never expose keys in this SPA.
- Worldpay must use hosted checkout, secure pharmacy merchant onboarding and verified server-side webhooks. The portal now models each pharmacy connection, but live onboarding/payment calls remain disabled until Worldpay approves the platform model and supplies credentials.
- Prescription scans require private UK-hosted storage, short-lived access links, retention rules and audit logging.
- The eligibility privacy notice and consent wording require solicitor/DPO approval before live use.

Prepared for Healius Consulting and its HHH platform.
