# HHH × Curaleaf — Production Architecture & Pharmacy Onboarding

**Status:** Architecture proposal for production build  
**Audience:** Engineering, operations, compliance  
**Related docs:** `uk-compliance-register.md` (master labelled checklist), `project-manager-playbook.md`, `specs/README.md`, `full_project_breakdown.md`, `Rocky_API_Technical_Requirements_v1.5.docx`

### Requirement labels (UK guidance)

All requirements in this document use the labels defined in **`uk-compliance-register.md`**:

| Label | Meaning |
|-------|---------|
| **REQ-UK** | Required by UK law (UK GDPR, DPA 2018, etc.) |
| **REQ-ICO** | Required ICO accountability measure |
| **REQ-GPHC** | Required under GPhC pharmacy standards (tenant + platform support) |
| **REQ-LEGAL** | Required legal document — solicitor / DPO advisor |
| **REQ-PLATFORM** | Required secure platform implementation — Developer |
| **REQ-PM** / **REQ-DEV** | Required action owner |
| **REC-UK** | Recommended UK best practice |
| **OPEN** | Decision outstanding — **PRE-BUILD** |
| **PRE-LIVE** | Must be complete before first live patient |

---

## 1. Executive summary

The production platform is a **multi-tenant SaaS** serving independent pharmacy partners. Each pharmacy is an isolated **tenant** with its own branding, embed domains, staff accounts, and Curaleaf Rocky API credentials.

Three user-facing surfaces:

| Surface | URL pattern | Embedded on pharmacy site? |
|---------|-------------|----------------------------|
| **Eligibility embed** | `portal.hhh.health/embed/eligibility/{slug}` | Yes — hardened iframe only |
| **Patient portal** | `portal.hhh.health/p/{slug}` or `{slug}.patient.hhh.health` | Optional — subdomain or path |
| **Clinician console** | `app.hhh.health` | No — separate authenticated app |

All patient and prescription data stays **server-side**. The browser never holds Rocky API keys, never stores card data (Worldpay hosted checkout), and never receives long-lived access to prescription scans (signed URLs with short TTL).

**Hosting principle:** **REQ-UK** — UK/EU data residency for anything storing or processing special-category health data (UK GDPR Article 9 — [ICO special category guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/)).

### 1.1 UK regulatory touchpoints (platform scope)

| Regime | Platform obligation | Pharmacy tenant obligation |
|--------|----------------------|---------------------------|
| **UK GDPR + DPA 2018** | Processor/controller duties per DPA; privacy by design; breach support | Controller duties if pharmacy is controller; RP oversight |
| **ICO** | DPIA, ROPA, sub-processor DPAs, breach process — see register | ICO registration; pharmacy privacy notice to patients |
| **GPhC Standards** | Display GPhC number, SP name, pharmacy address on embed/portal | CBPM risk assessment, CD storage, prescription verification |
| **GPhC distance selling** | Eligibility embed must not enable uncontrolled medicine ordering | Distance-selling risk assessment signed off |
| **PECR** | Cookie consent if non-essential cookies; lawful SMS/email rails | Marketing consent separate from clinical consent |
| **PCI DSS** | **REQ-UK** — hosted checkout only; no card data on HHH systems | Worldpay merchant relationship |
| **Misuse of Drugs / HMR** | Audit trail for supply chain; no platform bypass of Rx gate | CD register, secure storage, valid prescription check |

Full labelled checklist: **`uk-compliance-register.md`**.

---

## 2. High-level system diagram

```mermaid
flowchart TB
    subgraph public [Public internet]
        PharmacySite[Pharmacy website]
        PatientBrowser[Patient browser]
        StaffBrowser[Pharmacy staff browser]
    end

    subgraph edge [Edge layer - Cloudflare]
        WAF[WAF + DDoS]
        CDN[CDN / static assets]
        DNS[DNS]
    end

    subgraph frontend [Frontend apps - static SPA]
        EmbedApp[Eligibility embed]
        PatientApp[Patient portal]
        ClinicianApp[Clinician console]
        AdminApp[HHH admin - tenant onboarding]
    end

    subgraph backend [Backend - AWS London eu-west-2]
        API[API / BFF - Node or .NET]
        Worker[Background workers]
        Redis[(Redis - queues + cache)]
        Postgres[(PostgreSQL - tenant data)]
        S3[(S3 - Rx scans, invoices)]
        Secrets[Secrets Manager]
    end

    subgraph integrations [External integrations]
        Rocky[Curaleaf Rocky API]
        Worldpay[Worldpay hosted checkout]
        Postmark[Email - Postmark]
        Twilio[SMS - Twilio]
    end

    PharmacySite -->|sandboxed iframe| WAF
    PatientBrowser --> WAF
    StaffBrowser --> WAF
    WAF --> CDN
    CDN --> EmbedApp
    CDN --> PatientApp
    CDN --> ClinicianApp
    CDN --> AdminApp

    EmbedApp --> API
    PatientApp --> API
    ClinicianApp --> API
    AdminApp --> API

    API --> Postgres
    API --> Redis
    API --> S3
    API --> Secrets
    Worker --> Redis
    Worker --> Postgres
    Worker --> Rocky
    Worker --> Postmark
    Worker --> Twilio
    API --> Worldpay
    Worldpay -->|webhook| API
    API --> Rocky
```

---

## 3. Application architecture

### 3.1 Monorepo structure (recommended)

```
hhh-platform/
├── apps/
│   ├── embed-eligibility/     # Minimal bundle for iframe embed
│   ├── patient-portal/        # Patient-facing SPA
│   ├── clinician-app/         # Staff console (current prototype → production)
│   └── admin-portal/          # HHH internal: tenant onboarding, support
├── packages/
│   ├── api-client/            # Typed API client shared across apps
│   ├── ui/                    # Shared design system components
│   └── types/                 # Shared TypeScript schemas
├── services/
│   ├── api/                   # REST/GraphQL BFF
│   └── worker/                # Shipment polling, notifications, retries
└── infra/                     # Terraform or Pulumi (IaC)
```

The current prototype (`src/`) maps to `apps/clinician-app` plus shared packages. Split before production — do not ship one bundle for all surfaces.

### 3.2 Backend API (BFF pattern)

Single API service that:

- **REQ-PLATFORM / REQ-DEV:** Authenticates staff (JWT + **REQ-ICO MFA**) and patients (magic link / SMS OTP)
- **REQ-PLATFORM / REQ-DEV:** Enforces **tenant isolation** on every query (`pharmacy_id` from auth context)
- **REQ-PLATFORM / REQ-DEV:** Proxies Curaleaf Rocky API using per-tenant credentials from Secrets Manager
- **REQ-PLATFORM / REQ-DEV:** Issues short-lived signed URLs for prescription scan download
- **REQ-UK / REQ-DEV:** Creates Worldpay payment sessions; verifies webhooks — **hosted checkout only**
- **REQ-ICO / REQ-DEV:** Writes audit logs for every read/write of patient data (supports Art. 15 access requests)
- **REQ-PLATFORM / REQ-DEV:** Generates dynamic CSP `frame-ancestors` headers per tenant for embed routes
- **REQ-UK / REQ-DEV:** Captures granular **explicit consent** on eligibility submissions (care vs marketing separate)
- **REQ-GPHC / REQ-DEV:** Surfaces pharmacy GPhC number, superintendent pharmacist, and address on tenant surfaces

**Do not** expose Rocky endpoints directly to the browser.

### 3.3 Background workers

Separate worker process (same codebase, different entrypoint):

| Job | Schedule / trigger | Purpose |
|-----|-------------------|---------|
| Shipment poller | Every 5 min per active order | `GET /shipments` — Rocky has no webhooks |
| Payment reconciliation | On webhook + hourly sweep | Match Worldpay refs to sub-orders |
| Notification dispatcher | Event-driven | Payment link, paid confirmation, ready for collection |
| Draft order expiry | Daily | Clear stale draft orders (>24h per TRD F-26) |
| Credential health check | Daily | Test Rocky auth per tenant; alert on failure |

Queue: **Redis + BullMQ** (simple start) or **AWS SQS** (scale).

### 3.4 Data model (core entities)

```
organisations (pharmacy tenants)
├── id, slug, name, branding, status
├── allowed_embed_domains[]
├── collection_address, collection_place_name
└── rocky_credentials_ref → Secrets Manager

staff_users
├── organisation_id, email, role (counter | manager | admin)
└── mfa_enabled

patients (CRM)
├── organisation_id, name, email, mobile, address
└── status, interactions[] (audit timeline)

eligibility_submissions
├── organisation_id, patient fields, consent flags
└── status pipeline (New → Records uploaded → Referred → Completed)

orders
├── organisation_id, patient_id
└── prescriptions[] (sub-orders)
    ├── scan_s3_key, prescriber, line_items[]
    ├── payment { status, amount, worldpay_ref }
    ├── rocky { prescription_ref, po_ref }
    └── fulfillment { status, tracking, ready_at, collected_at }

audit_logs (append-only)
├── actor, action, resource_type, resource_id, ip, timestamp
```

PostgreSQL with **row-level security (RLS)** policies keyed on `organisation_id`.

---

## 4. Security & confidentiality

### 4.1 Data classification

| Class | UK basis | Examples | Storage | Access |
|-------|----------|----------|---------|--------|
| **Special category (Art. 9)** | **REQ-UK** — [ICO Art. 9](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/) | Medical condition, prescription scans, Rx line items | Encrypted DB + private S3 | Staff RBAC; patient sees own data only |
| **Personal data** | **REQ-UK** — UK GDPR | Name, email, mobile, address | Encrypted DB | Tenant-scoped |
| **Financial** | **REQ-UK** — PCI avoided via hosted checkout | Payment refs, amounts only — **no PAN/CVV** | DB | Staff + patient (own orders) |
| **Secrets** | **REQ-PLATFORM** | Rocky API keys | Secrets Manager | API service only |
| **Public** | — | Product formulary (non-patient-linked) | Cache | Authenticated staff |

### 4.2 Authentication

| User | Method | Session |
|------|--------|---------|
| **Staff** | Email + password + **MFA (TOTP)** | HttpOnly cookie, 8h TTL, refresh token |
| **Patient** | Magic link or SMS OTP | HttpOnly cookie, 1h TTL, `SameSite=None` for embed |
| **Admin (HHH)** | SSO + MFA | Separate admin auth realm |

Roles: `counter_staff`, `pharmacist`, `manager`, `org_admin`, `hhh_superadmin`.

### 4.3 Hardened embed (**REQ-PLATFORM** — mandatory, no simple mode)

**REQ-GPHC:** Embed is an eligibility pre-screening surface only — not an online medicine ordering basket ([GPhC distance selling guidance](https://www.pharmacyregulation.org/guidance/standards-and-guidance/guidance-for-registered-pharmacies-providing-pharmacy-services-at-a-distance-including-on-the-internet)).

Pharmacies receive one embed snippet:

```html
<iframe
  id="hhh-eligibility"
  src="https://portal.hhh.health/embed/eligibility/{slug}"
  title="Medical cannabis eligibility check"
  width="100%"
  height="720"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  sandbox="allow-scripts allow-forms allow-same-origin allow-popups-to-escape-sandbox"
  style="width:100%;min-height:720px;border:0;border-radius:12px;display:block"
></iframe>
<script
  src="https://portal.hhh.health/embed/v1/resizer.js"
  data-pharmacy="{slug}"
  defer
></script>
```

Platform serves on `/embed/*`:

```http
Content-Security-Policy: frame-ancestors https://{verified-domain} https://www.{verified-domain}; ...
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Domains are whitelisted per tenant only after ownership verification.

### 4.4 Encryption

- **In transit:** TLS 1.2+ everywhere (Cloudflare → origin)
- **At rest:** RDS encryption (AES-256), S3 SSE-KMS, Redis encryption in transit
- **Prescription scans:** S3 private bucket, no public ACLs, signed URL max 15 min
- **Backups:** Encrypted, UK region, 30-day retention minimum

### 4.5 UK compliance checklist (**PRE-LIVE**)

Cross-reference: **`uk-compliance-register.md`** (IDs in parentheses).

#### Legal & ICO accountability
- [ ] **REQ-ICO (G-01)** DPIA completed and signed off — mandatory for special category + online access ([ICO DPIA guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-impact-assessments/))
- [ ] **REQ-ICO (G-02)** Record of Processing Activities (ROPA) maintained
- [ ] **REQ-LEGAL (C-03, C-04)** Partner agreement + DPA templates approved by solicitor
- [ ] **REQ-UK (G-06, G-07)** DPA signed: each pharmacy + all sub-processors (AWS, Worldpay, Twilio, Postmark, Curaleaf)
- [ ] **REQ-UK (G-03, G-04)** Privacy notices published; eligibility **explicit consent** wording live
- [ ] **REQ-ICO (G-05)** Appropriate Policy Document (if DPA 2018 Sch. 1 Art. 9 condition used)
- [ ] **REQ-UK (C-05)** HHH ICO registration complete (if advised)
- [ ] **REQ-ICO (G-08)** Data retention policy documented **and** automated deletion jobs deployed
- [ ] **REQ-ICO (G-09)** Personal data breach procedure (72h ICO notification where required — Arts. 33–34)
- [ ] **REQ-ICO (G-10)** Individual rights request process (access, erasure, rectification)
- [ ] **REQ-UK (G-11, G-12)** PECR: cookie consent (if needed); lawful SMS/email for notifications

#### GPhC & pharmacy professional (per tenant)
- [ ] **REQ-GPHC (P-01–P-03)** GPhC number, superintendent pharmacist, address displayed on embed/portal
- [ ] **REQ-GPHC (P-04)** Pharmacy CBPM / distance-selling risk assessment on file
- [ ] **REQ-GPHC (P-05)** Staff training + confidentiality acknowledgement recorded
- [ ] **REQ-GPHC (P-06)** Pharmacy professional indemnity confirmed

#### Platform technical
- [ ] **REQ-PLATFORM (T-01–T-09)** UK hosting, encryption, tenant isolation, MFA, audit logs, hardened embed, no card data
- [ ] **REC-UK (G-13, T-10)** Cyber Essentials; WCAG 2.2 AA patient surfaces

---

## 5. Hosting recommendations

### 5.1 Recommended stack (production)

| Layer | Service | Region | Rationale |
|-------|---------|--------|-----------|
| **DNS + WAF + CDN** | Cloudflare Pro | Global edge, origin in UK | DDoS, bot protection, SSL, rate limiting |
| **Frontend (SPAs)** | Cloudflare Pages or AWS S3 + CloudFront | Assets global; no PHI in bundles | Fast, cheap, easy CI deploy |
| **API** | AWS ECS Fargate or App Runner | **eu-west-2 (London)** | UK data residency, auto-scale |
| **Workers** | AWS ECS Fargate (same cluster) | **eu-west-2** | Co-located with API and DB |
| **Database** | AWS RDS PostgreSQL 16 | **eu-west-2** | RLS, automated backups, Multi-AZ for prod |
| **Cache / queue** | AWS ElastiCache Redis | **eu-west-2** | Job queues, formulary cache (15 min TTL) |
| **File storage** | AWS S3 | **eu-west-2** | Rx scans, invoice PDFs |
| **Secrets** | AWS Secrets Manager | **eu-west-2** | Per-tenant Rocky credentials |
| **Email** | Postmark | EU processing available | Transactional email, good deliverability |
| **SMS** | Twilio | Configure UK routing | Payment links, ready-for-collection |
| **Payments** | Worldpay | Hosted checkout | PCI scope stays with Worldpay |
| **Monitoring** | Sentry + CloudWatch + PagerDuty | — | Errors, uptime, alerts |
| **CI/CD** | GitHub Actions | — | Deploy to staging → prod with approval gate |

### 5.2 Domain structure

| Domain | Purpose |
|--------|---------|
| `hhh.health` | Marketing / corporate |
| `portal.hhh.health` | Patient embed + patient portal |
| `app.hhh.health` | Clinician console |
| `admin.hhh.health` | HHH internal admin (IP-restricted or VPN) |
| `api.hhh.health` | API (not public-facing docs; staff/patient apps call this) |

Optional per-pharmacy white-label:

| Domain | Purpose |
|--------|---------|
| `prescriptions.{pharmacy-domain}.co.uk` | CNAME → `portal.hhh.health` (tenant routing by hostname) |

### 5.3 Environments

| Environment | Purpose | Data |
|-------------|---------|------|
| **dev** | Local + shared dev API | Synthetic seed data only |
| **staging** | Pre-prod QA, pharmacy UAT | Anonymised test data; Rocky sandbox credentials |
| **prod** | Live | Real patient data |

Each environment: separate AWS account or at minimum separate VPC, DB, and secrets namespace.

### 5.4 Alternative: simpler start (still UK-compliant)

If AWS ops overhead is too much early on:

| Layer | Alternative |
|-------|-------------|
| API + workers | **Railway** or **Fly.io** (London region) |
| Database | **Supabase** (London) or Railway Postgres |
| Files | **Cloudflare R2** (EU jurisdiction) |
| Frontend | Cloudflare Pages |

Migrate to AWS when you hit ~10 pharmacies or need formal NHS-adjacent audit requirements.

### 5.5 Rough monthly cost estimate (single region, early scale)

| Item | ~Cost (5 pharmacies, low traffic) |
|------|-----------------------------------|
| Cloudflare Pro | £20 |
| AWS (RDS db.t4g.small, ECS 2 tasks, S3, Redis) | £150–250 |
| Postmark + Twilio | £30–80 (volume-dependent) |
| Sentry | £0–26 |
| **Total infra** | **~£200–400/mo** |

Scales with pharmacy count, shipment polling volume, and SMS sends — not with embed page views (static/CDN).

---

## 6. Integration architecture

```mermaid
sequenceDiagram
    participant P as Patient
    participant E as Eligibility embed
    participant API as HHH API
    participant S as Staff app
    participant WP as Worldpay
    participant R as Rocky API
    participant W as Worker

    P->>E: Submit eligibility form
    E->>API: POST /submissions (tenant slug)
    API->>API: Store submission, audit log
    S->>API: Review, upload records, refer to clinic
    S->>API: Build order, link CRM patient
    S->>API: Send payment link
    API->>WP: Create hosted payment session
    API->>P: Email/SMS payment link
    P->>WP: Pay on hosted page
    WP->>API: Webhook payment.confirmed
    API->>R: POST /prescription (per sub-order)
    API->>R: POST /purchase-order
    W->>R: GET /shipments (poll every 5 min)
    W->>API: Update fulfillment status
    S->>API: Confirm goods-in
    API->>P: SMS ready for collection
    S->>API: Mark collected
```

| Integration | Direction | Auth | Notes |
|-------------|-----------|------|-------|
| Rocky `GET /products` | API → Rocky | Per-tenant API key | Cache 15 min |
| Rocky `POST /prescription` | API → Rocky | Per-tenant | Sequential per TRD F-25 |
| Rocky `POST /purchase-order` | API → Rocky | Per-tenant | Gated on payment + scan |
| Rocky `GET /shipments` | Worker → Rocky | Per-tenant | Poll; no webhooks |
| Worldpay | API ↔ Worldpay | Merchant ID per tenant or pooled | Hosted checkout only |
| Postmark / Twilio | Worker → provider | API keys | Templates per tenant branding |

---

## 7. Pharmacy onboarding — full playbook

### Phase 0 — Commercial & legal (**PRE-LIVE** — before any technical work)

| Step | Label | Owner | Output |
|------|-------|-------|--------|
| 0.1 | **REQ-LEGAL (C-03)** | Project Manager | Signed pharmacy partner agreement |
| 0.2 | **REQ-UK (G-06, G-07)** | Solicitor + Project Manager | DPA signed (pharmacy ↔ HHH; HHH ↔ subprocessors) |
| 0.3 | **REQ-UK** | Pharmacy / Project Manager | Pharmacy ICO registration confirmed; RP contact named |
| 0.4 | **REQ-LEGAL (C-07) OPEN** | Solicitor | Data controller/processor roles documented |
| 0.5 | **REQ-ICO (G-01)** | Advisor + Developer input | Platform DPIA signed off |
| 0.6 | **REQ-ICO (G-02)** | Project Manager + advisor | ROPA completed |
| 0.7 | **REQ-UK (G-03, G-04)** | Solicitor + Developer | Privacy notices + consent wording live in embed |
| 0.8 | **REQ-GPHC (P-04, P-06)** | Pharmacy / Project Manager | CBPM risk assessment + indemnity on file |
| 0.9 | **REQ-PM (I-04)** | Pharmacy → Project Manager | Curaleaf Rocky API credentials requested |
| 0.10 | **OPEN (I-01)** | Project Manager + solicitor | Worldpay merchant setup (per pharmacy vs HHH model) |

**Gate:** **PRE-LIVE** — No production tenant until **0.1** and **0.2** complete. No live patient data until **0.5** and **0.7** complete.

---

### Phase 1 — Tenant provisioning (**REQ-DEV** — HHH admin)

| Step | Label | Action | System |
|------|-------|--------|--------|
| 1.1 | **REQ-PLATFORM (T-12)** | Create organisation record | Admin portal |
| 1.2 | **REQ-PLATFORM** | Assign unique slug (e.g. `east-mids-lincoln`) | `organisations.slug` |
| 1.3 | **REQ-GPHC (P-01–P-03)** | Enter legal name, **GPhC number**, superintendent pharmacist, collection address | Admin portal |
| 1.4 | **REQ-PLATFORM** | Upload branding: logo, primary colour, display name | S3 + DB |
| 1.5 | **REQ-PLATFORM (T-09)** | Store Rocky API credentials | Secrets Manager: `rocky/{org_id}` |
| 1.6 | **REQ-UK (T-07)** | Configure Worldpay merchant reference | Secrets Manager or DB config |
| 1.7 | **REQ-UK (G-12)** | Notification templates — lawful care messages only; marketing separate | Template engine |
| 1.8 | **REQ-ICO / REQ-PLATFORM (T-04)** | Create staff admin; invite → **MFA** setup | Auth service |

**Output:** Tenant in `draft` status.

---

### Phase 2 — Domain verification & embed setup

| Step | Label | Action | Details |
|------|-------|--------|---------|
| 2.1 | **REQ-PM** | Pharmacy submits website domain(s) | e.g. `eastmidlandspharmacy.co.uk` |
| 2.2 | **REQ-PLATFORM (T-06)** | Issue DNS TXT challenge | `_hhh-verify.{domain} TXT hhh-verify={token}` |
| 2.3 | **REQ-DEV** | Verification check | Admin portal shows verified ✓ |
| 2.4 | **REQ-PLATFORM (T-06)** | Whitelist `allowed_embed_domains` | Drives CSP `frame-ancestors` |
| 2.5 | **REQ-PLATFORM (T-06)** | Generate hardened embed + QR PDF | Admin portal download |
| 2.6 | **REC-UK** | Optional patient portal CNAME | `prescriptions.{domain}` → `portal.hhh.health` |

**Gate:** **PRE-LIVE (GL-06)** — Embed code not issued until domain verified.

---

### Phase 3 — Staff onboarding

| Step | Label | Action | Details |
|------|-------|--------|---------|
| 3.1 | **REQ-PM** | Invite staff users | Roles: counter / manager / pharmacist |
| 3.2 | **REQ-ICO (T-04)** | MFA on first login | TOTP required |
| 3.3 | **REQ-GPHC (P-05)** | 30-min training session | Referrals → Create order → Payment → Orders; CBPM awareness |
| 3.4 | **REQ-PM** | Quick-reference PDF / Loom | Three lawful patient notifications only |
| 3.5 | **REQ-GPHC / REQ-ICO** | Confidentiality acknowledgement | Logged in audit trail |

---

### Phase 4 — Staging UAT (pharmacy tests before go-live)

| Step | Test | Pass criteria |
|------|------|---------------|
| 4.1 | Embed loads on pharmacy staging site | Form renders; CSP allows frame; sandbox works |
| 4.2 | Submit test eligibility enquiry | Appears in Referrals tab within 30s |
| 4.3 | Walk full referral flow | OCR upload → clinic refer → CRM confirmed |
| 4.4 | Build test order with formulary products | Margin warnings show; sub-order gating works |
| 4.5 | Send test payment link | Worldpay sandbox payment completes |
| 4.6 | Simulate Rocky submission | Sandbox PO ref returned (or mocked in staging) |
| 4.7 | Simulate goods-in + collection | Patient SMS fires; barcode displays |
| 4.8 | Verify tenant isolation | Staff cannot see other pharmacy data |
| 4.9 | CSP negative test | Embed blocked on unlisted domain |

**Gate:** **PRE-LIVE (GL-08)** — Pharmacy manager signs UAT checklist.

---

### Phase 5 — Go-live (**PRE-LIVE** — all GL-* gates in `uk-compliance-register.md` §2.6)

| Step | Label | Action | Details |
|------|-------|--------|---------|
| 5.1 | **REQ-PM** | Tenant `draft` → `active` | Admin portal — only after GL-01–GL-08 |
| 5.2 | **REQ-DEV (I-04)** | Rocky sandbox → production credentials | Secrets Manager |
| 5.3 | **REQ-DEV (I-05)** | Worldpay sandbox → live merchant | Config update |
| 5.4 | **REQ-PM** | Embed live on production website | Hardened snippet only |
| 5.5 | **REQ-DEV** | Monitor first 48h | Errors, webhooks, submissions |
| 5.6 | **REQ-PM** | Go-live confirmation to pharmacy | Support + ICO/GPhC complaint route if applicable |

---

### Phase 6 — Ongoing operations

| Cadence | Activity |
|---------|----------|
| **Daily** | Monitor API errors, failed webhooks, Rocky auth failures |
| **Weekly** | Review onboarding pipeline; check uncollected medication alerts |
| **Monthly** | Invoice reconciliation per pharmacy; review audit logs sample |
| **Quarterly** | Access review (staff accounts); dependency patch cycle |
| **Annually** | DPIA review; penetration test; DPA renewal check |

---

## 8. Admin portal capabilities (HHH internal)

The admin app supports onboarding and support without engineering involvement:

- Create / suspend / archive tenants
- Domain verification workflow
- Generate embed pack (iframe + QR + instructions PDF)
- Rotate Rocky credentials
- Impersonate tenant (read-only, audit-logged) for support
- View platform-wide metrics: active tenants, submissions/day, payment success rate
- Manage feature flags per tenant (e.g. auto-place on payment)

---

## 9. Deployment & CI/CD

```mermaid
flowchart LR
    PR[Pull request] --> CI[GitHub Actions CI]
    CI -->|lint, test, build| StagingDeploy[Deploy staging]
    StagingDeploy --> UAT[Manual UAT]
    UAT -->|Approved| ProdDeploy[Deploy production]
    ProdDeploy --> Smoke[Smoke tests]
```

| App | Deploy target | Trigger |
|-----|---------------|---------|
| embed-eligibility, patient-portal, clinician-app | Cloudflare Pages | Merge to `main` → staging; tag `v*` → prod |
| api, worker | AWS ECS | Same pipeline; blue/green or rolling deploy |
| DB migrations | Flyway / Prisma migrate | Run before API deploy; backward-compatible only |

Secrets injected at runtime from AWS Secrets Manager — never in CI logs or env files in repo.

---

## 10. Rollout phasing (engineering)

Aligns product delivery with onboarding readiness:

| Phase | Build | Onboard pharmacies when |
|-------|-------|---------------------------|
| **P1 — Foundation** | API, auth, multi-tenant DB, admin portal, hardened embed, eligibility submissions | Ready for intake-only partners |
| **P2 — Clinical ops** | Clinician app (Referrals, Patients, CRM), audit logs | Referral workflow live |
| **P3 — Commerce** | Create order, Worldpay, Awaiting payment | Payment before order model |
| **P4 — Fulfillment** | Rocky integration, Orders tab, shipment polling, goods-in, collection | Full end-to-end |
| **P5 — Patient portal** | Magic-link login, payment, collection pass, repeat requests | Patient self-service |

Do not onboard to P4 flows until P4 is deployed — match pharmacy expectations to available features.

---

## 11. What pharmacies experience (one-page summary)

Give every new partner this summary:

1. **Sign** partner agreement and DPA  
2. **Provide** GPhC details, logo, website domain, staff emails, Curaleaf credentials  
3. **Verify** domain (one DNS TXT record)  
4. **Paste** embed code on your website (we provide snippet + QR)  
5. **Train** staff (30 min session + video)  
6. **UAT** on staging (half day)  
7. **Go live** — we monitor the first 48 hours  

They never install software. They never manage servers. They never touch Rocky or Worldpay directly.

---

## 12. Open decisions (**OPEN — PRE-BUILD**)

| # | Label | Decision | Options | Impact |
|---|-------|----------|---------|--------|
| 1 | **REQ-LEGAL (C-07)** | Data controller | Pharmacy vs HHH as controller | DPA, privacy policy, ICO, Art. 6/9 basis |
| 2 | **OPEN (I-01)** | Worldpay model | Per-pharmacy merchant vs HHH aggregator | Onboarding, reconciliation, PCI |
| 3 | **OPEN** | Patient portal URL | Shared `portal.hhh.health/p/{slug}` vs CNAME | DNS Phase 2 |
| 4 | **OPEN** | OCR / records upload | Build vs integrate | Referrals flow |
| 5 | **OPEN (I-02)** | Rocky PO model | Consolidated vs one PO per prescription (TRD §9 #14) | Order submission logic |
| 6 | **REQ-LEGAL** | Art. 9 condition per processing activity | Consent (embed) vs Art. 9(2)(h) health care (CRM/Rx) | Consent UI + Appropriate Policy Document |

---

## 13. UK documents still to produce (outside repo)

| Document | Label | Owner |
|----------|-------|-------|
| DPIA | **REQ-ICO (G-01)** | Advisor + Developer input |
| ROPA | **REQ-ICO (G-02)** | Project Manager + advisor |
| Privacy notices (patient, staff) | **REQ-UK (G-03)** | Solicitor |
| Eligibility consent wording | **REQ-UK (G-04)** | Solicitor; Developer implements |
| Appropriate Policy Document | **REQ-ICO (G-05)** | Solicitor (if Sch. 1 condition used) |
| Breach response runbook | **REQ-ICO (G-09)** | Project Manager + Developer |
| UAT sign-off template | **PRE-LIVE (GL-08)** | Project Manager |
| Pharmacy onboarding form | **REQ-PM** | Project Manager |

---

*Prepared for HHH platform production planning. All labelled requirements tracked in `uk-compliance-register.md`. Revise when ICO/GPhC guidance or Curaleaf TRD §9 items change.*
