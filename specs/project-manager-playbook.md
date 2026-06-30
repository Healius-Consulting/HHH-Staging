# HHH Platform — Project Manager (Owner) Playbook

**Purpose:** Single document for go-live planning. Use this with the Developer to assign every task before the first live pharmacy.  
**Partner role:** Developer (platform build, hosting, integrations)  
**Last updated:** June 2026

> **How to use this doc:** Work top to bottom. **Section 3** is the master checklist — tick items as you go. **Section 4** is the per-pharmacy runbook. **Section 12** is tomorrow’s meeting agenda with the Developer.

---

## 1. What you are delivering

**Holistic Health Hub (HHH)** is a multi-tenant platform that lets independent pharmacies:

1. Embed an **eligibility pre-screening form** on their existing website (hardened iframe)
2. Manage **referrals → prescriptions → patient payment → Curaleaf ordering → collection** in a staff console
3. Optionally give patients a **portal** (pay, track, collect)

**End-to-end journey:** Eligibility intake → clinic referral → prescription issued → order from Curaleaf (Rocky API) → patient pays (Worldpay) → goods arrive at pharmacy → patient collects.

**Your job:** Get pharmacies signed, compliant, trained, and live. Chase legal, Curaleaf, and Worldpay. First line of support.

**Developer’s job:** Build, host, secure, and integrate everything. You do not need to understand the code — but you must not go live until their **Section 3C** items are done for the phase you are launching.

---

## 2. Roles, labels, and hard gates

### 2.1 Who owns what

| Area | Project Manager (Owner) | Developer |
|------|-------------------------|-----------|
| Pharmacy sales & relationships | ✅ Owns | Supports demos |
| Solicitor, DPA, ICO, DPIA process | ✅ Runs | Technical annex only |
| Curaleaf / Worldpay chasing | ✅ Owns | Builds integrations |
| Pharmacy onboarding & training | ✅ Owns | Provisions tenant |
| First-line support | ✅ Owns triage | Bugs & outages |
| Platform build, security, hosting | — | ✅ Owns |

### 2.2 Requirement labels

| Label | Meaning |
|-------|---------|
| **REQ-UK** | UK law — must have before live patient data |
| **REQ-ICO** | ICO accountability (DPIA, ROPA, breach process, etc.) |
| **REQ-GPHC** | GPhC pharmacy standards — pharmacy must comply; you verify |
| **REQ-LEGAL** | Solicitor / DPO advisor must draft or approve |
| **REQ-PM** | Your action |
| **REQ-DEV** | Developer action — you verify before go-live |
| **REC-UK** | Strongly recommended (Cyber Essentials, insurance) |
| **OPEN** | Decision not made yet — resolve in Section 11 |
| **PRE-LIVE** | Must be ☑ before first real patient |

### 2.3 Hard gates (non-negotiable)

| Gate | Rule |
|------|------|
| **Gate 1** | No production tenant until **partner agreement + DPA** signed for that pharmacy |
| **Gate 2** | No live patient data until **DPIA signed off + privacy notice + consent wording** live on embed |
| **Gate 3** | No embed on public website until **domain verified** |
| **Gate 4** | No go-live until **pharmacy manager signs UAT** (Section 8) |
| **Gate 5** | Match pharmacy promise to **platform phase** (Section 10) — do not sell full order flow if only intake is built |

---

## 3. Master checklist — everything before go-live

Copy this into a shared tracker (Notion / spreadsheet). Each row: **Owner | Status ☐ | Notes | Target date**

---

### 3A. Company & founder (once — before first pharmacy partner)

| ID | Label | Task | Owner | Done |
|----|-------|------|-------|------|
| C-01 | REQ-LEGAL | **HHH Ltd** incorporated (if not already) | PM + directors | ☐ |
| C-02 | REQ-LEGAL | **Founder / shareholder agreement** between you and Developer (or other founders) | PM + solicitor | ☐ |
| C-03 | REQ-LEGAL | **Partner agreement template** (pharmacy ↔ HHH) drafted by solicitor | Solicitor; PM negotiates | ☐ |
| C-04 | REQ-LEGAL | **DPA template** + written **controller/processor opinion** | Solicitor | ☐ |
| C-05 | REQ-UK | **HHH ICO registration** at [ico.org.uk/data-protection-fee](https://ico.org.uk/for-organisations/data-protection-fee/) (~£40–60/yr) — after solicitor confirms you must register | PM | ☐ |
| C-06 | REC-UK | **Professional indemnity + cyber insurance** for HHH | PM | ☐ |
| C-07 | OPEN | **Decide data controller model:** pharmacy = controller / HHH = processor (typical) OR HHH = controller — **solicitor must confirm** | Solicitor | ☐ |

**Solicitor brief (first engagement, ~£1.5k–£5k):** C-03, C-04, C-07, privacy notices, Art. 6 + Art. 9 lawful basis for health data.

---

### 3B. HHH platform compliance (once — before first live patient)

| ID | Label | Task | Owner | Done |
|----|-------|------|-------|------|
| G-01 | REQ-ICO | **DPIA** (Data Protection Impact Assessment) — special category health data + online access = high risk | Advisor signs; DEV writes technical sections | ☐ |
| G-02 | REQ-ICO | **ROPA** (Record of Processing Activities) | PM + advisor; DEV lists what system processes | ☐ |
| G-03 | REQ-UK | **Privacy notices** published — patient (embed + portal), staff | Solicitor drafts; DEV implements | ☐ |
| G-04 | REQ-UK | **Eligibility form consent wording** — care vs marketing **separate** checkboxes; explicit consent for health data | Solicitor drafts; DEV implements | ☐ |
| G-05 | REQ-ICO | **Appropriate Policy Document** (if using DPA 2018 Schedule 1 for health care processing) | Solicitor / advisor | ☐ |
| G-06 | REQ-UK | **DPA signed with each pharmacy** (use template from C-04) | PM | ☐ |
| G-07 | REQ-UK | **Sub-processor DPAs on file:** AWS, Worldpay, Twilio, Postmark, Curaleaf | PM obtains; solicitor reviews | ☐ |
| G-08 | REQ-ICO | **Data retention policy** written; DEV implements automated deletion | Advisor approves periods; DEV builds | ☐ |
| G-09 | REQ-ICO | **Personal data breach procedure** — who calls who; 72h ICO notification if required | PM + advisor; DEV containment | ☐ |
| G-10 | REQ-ICO | **Individual rights procedure** — patient access / erasure requests | PM process; DEV tooling | ☐ |
| G-11 | REQ-UK | **Cookie consent** on embed/portal if non-essential cookies used | DEV + solicitor wording | ☐ |
| G-12 | REQ-UK | **PECR:** only 3 lawful patient SMS/emails (pay request, paid confirmation, ready for collection) — **no marketing** without separate consent | PM approves copy | ☐ |
| G-13 | REC-UK | **Cyber Essentials** certification (pharmacies will ask) | DEV certifies; PM files certificate | ☐ |

**Suggested retention (solicitor must approve):** eligibility enquiries not progressed 12 months; prescription records 8 years; payment records 7 years; audit logs 7 years; unpaid draft orders 24 hours.

---

### 3C. Developer platform build (verify with Developer — block go-live if missing)

| ID | Label | Task | Owner | Done |
|----|-------|------|-------|------|
| T-01 | REQ-DEV | UK hosting (London) for all patient data | DEV | ☐ |
| T-02 | REQ-DEV | Encryption in transit and at rest | DEV | ☐ |
| T-03 | REQ-DEV | Multi-tenant isolation — pharmacies cannot see each other’s data | DEV | ☐ |
| T-04 | REQ-DEV | Staff **MFA**; patient magic link / SMS login | DEV | ☐ |
| T-05 | REQ-DEV | Audit logs for patient data access | DEV | ☐ |
| T-06 | REQ-DEV | **Hardened iframe embed** + domain whitelist (CSP) | DEV | ☐ |
| T-07 | REQ-DEV | **Worldpay hosted checkout only** — no card data on HHH | DEV | ☐ |
| T-08 | REQ-DEV | Prescription scans in private storage; short-lived download links | DEV | ☐ |
| T-09 | REQ-DEV | Curaleaf API keys in secrets manager — never in browser | DEV | ☐ |
| T-10 | REC-UK | Accessible patient UI (WCAG 2.2 AA target) | DEV | ☐ |
| T-11 | REQ-DEV | Automated retention / deletion jobs | DEV | ☐ |
| T-12 | REQ-DEV | **Admin portal:** create tenant, verify domain, generate embed pack, invite staff | DEV | ☐ |

---

### 3D. Integrations & external (chase before full order flow)

| ID | Label | Task | Owner | Done |
|----|-------|------|-------|------|
| I-01 | OPEN | **Worldpay model decided:** each pharmacy has own merchant OR HHH aggregates | PM + solicitor | ☐ |
| I-02 | OPEN | **Curaleaf TRD §9** open items closed (see Section 9) | PM chases Mike Baker / Phil Jones | ☐ |
| I-03 | REQ-LEGAL | **DPA with Curaleaf** | PM | ☐ |
| I-04 | REQ-PM | **Rocky API credentials** per pharmacy (from Curaleaf) | PM → DEV | ☐ |
| I-05 | REQ-PM | **Worldpay merchant live** (or sandbox for UAT only) | PM → DEV | ☐ |

---

### 3E. Per-pharmacy go-live gate (**PRE-LIVE — all must be ☑**)

Use one copy of this table **per pharmacy**:

| ID | Requirement | Owner | Done |
|----|-------------|-------|------|
| GL-01 | Partner agreement signed (C-03) | PM | ☐ |
| GL-02 | DPA signed (G-06) | PM | ☐ |
| GL-03 | DPIA covers this pharmacy (G-01) | PM | ☐ |
| GL-04 | GPhC number, Superintendent Pharmacist, pharmacy address **visible on embed** (P-01–P-03) | PM collects; DEV displays | ☐ |
| GL-05 | Pharmacy **CBPM / distance-selling risk assessment** PDF on file (P-04) | PM | ☐ |
| GL-06 | Domain verified; embed pack issued to pharmacy web contact (T-06) | PM + DEV | ☐ |
| GL-07 | Staff trained + confidentiality acknowledgement logged (P-05) | PM | ☐ |
| GL-08 | **UAT signed** by pharmacy manager (Section 8) | PM | ☐ |
| GL-09 | Curaleaf Rocky credentials configured — *when order flow live* (I-04) | PM + DEV | ☐ |
| GL-10 | Worldpay live — *when payment flow live* (I-05) | PM + DEV | ☐ |

**Pharmacy-only GPhC items you must confirm (pharmacy responsible; you collect evidence):**

| ID | Item | Done |
|----|------|------|
| P-06 | Professional indemnity insurance in place | ☐ |
| P-07 | Controlled drugs secure storage + CD register at premises | ☐ |
| P-08 | Prescription verification workflow (valid specialist prescriber for CBPM) | ☐ |
| P-09 | SCR / clinical records access where possible (recommended) | ☐ |
| P-10 | Website uses embed for **eligibility only** — not uncontrolled online medicine ordering | ☐ |

---

## 4. Per-pharmacy onboarding runbook (step by step)

### Phase 0 — Legal & commercial (start here for each pharmacy)

| Step | What to do | Output |
|------|------------|--------|
| 0.1 | Send partner agreement (C-03); negotiate; chase signature | Signed PDF |
| 0.2 | Send DPA (G-06); chase signature | Signed PDF |
| 0.3 | Collect **Section 5 onboarding form** (all fields) | Completed form |
| 0.4 | Confirm pharmacy **ICO registration number** | Recorded |
| 0.5 | Obtain pharmacy **CBPM / distance-selling risk assessment** (P-04) | PDF on file |
| 0.6 | Confirm **professional indemnity** (P-06) | Written confirmation |
| 0.7 | Request **Curaleaf Rocky credentials** from pharmacy / Curaleaf (I-04) | Username + key |
| 0.8 | Initiate **Worldpay merchant** setup per I-01 decision (I-05) | Merchant ref |

**Stop:** Do not ask Developer for production tenant until GL-01 + GL-02 done.

---

### Phase 1 — Tenant setup (Developer)

| Step | What to do | Who |
|------|------------|-----|
| 1.1 | Email Developer the completed **Section 5 form** + signed PDFs | PM |
| 1.2 | Developer creates tenant (slug, branding, GPhC details, secrets) on **staging** | DEV |
| 1.3 | Developer confirms staging URL + staff admin invite sent | DEV |
| 1.4 | You verify GPhC name, number, SP, address appear correctly on staging embed | PM |

---

### Phase 2 — Domain & embed

| Step | What to do | Who |
|------|------------|-----|
| 2.1 | Get pharmacy website domain(s) from onboarding form | PM |
| 2.2 | Developer sends DNS TXT instructions: `_hhh-verify.{domain}` | DEV |
| 2.3 | Pharmacy web person adds TXT record | Pharmacy |
| 2.4 | Developer confirms verified ✓; generates **embed pack** (iframe + QR + instructions) | DEV |
| 2.5 | You send embed pack to pharmacy web contact with **Section 7** instructions | PM |
| 2.6 | Confirm embed on **staging** site first — form loads, consent works | PM |

---

### Phase 3 — Staff & training

| Step | What to do | Who |
|------|------------|-----|
| 3.1 | Developer invites staff emails; all complete **MFA** on first login | DEV + staff |
| 3.2 | Run **30-minute training** (Section 6 outline) | PM |
| 3.3 | Share quick-reference / Loom from Developer when available | PM |
| 3.4 | Each staff member signs **confidentiality acknowledgement** — you file it | PM |

---

### Phase 4 — UAT on staging

| Step | What to do | Who |
|------|------------|-----|
| 4.1 | Walk through **Section 8 UAT checklist** with pharmacy manager | PM |
| 4.2 | Fix issues; Developer resolves bugs | DEV |
| 4.3 | Manager signs **Section 8 sign-off** | Pharmacy manager |

---

### Phase 5 — Go-live

| Step | What to do | Who |
|------|------------|-----|
| 5.1 | Confirm **all GL-01–GL-10** applicable to current platform phase | PM |
| 5.2 | Developer switches tenant to **production**; live Rocky/Worldpay if phase requires | DEV |
| 5.3 | Pharmacy publishes embed on **production** website | Pharmacy web person |
| 5.4 | You verify live form submission appears in Referrals within 30 minutes | PM |
| 5.5 | **48-hour check-in call** with pharmacy | PM |
| 5.6 | Send go-live confirmation email with support contact | PM |

---

## 5. Pharmacy onboarding form (collect before Phase 1)

Send as Google Form or PDF. All fields required unless marked optional.

### Business & legal
- [ ] Legal pharmacy name  
- [ ] GPhC registration number  
- [ ] Superintendent Pharmacist — full name + GPhC number  
- [ ] Registered pharmacy address  
- [ ] Collection address (if different — where patients collect)  
- [ ] Responsible pharmacist contact (name, email, phone)  
- [ ] Pharmacy ICO registration number  
- [ ] Professional indemnity — insurer name + policy ref (or confirmation letter)  
- [ ] Attach: signed partner agreement (after Phase 0.1)  
- [ ] Attach: signed DPA (after Phase 0.2)  
- [ ] Attach: CBPM / distance-selling risk assessment PDF  

### Branding & website
- [ ] Logo file (PNG or SVG, min 200px)  
- [ ] Primary brand colour (hex code)  
- [ ] Display name (if different from legal name)  
- [ ] Website domain for embed (e.g. `eastmidlandspharmacy.co.uk`)  
- [ ] Staging website URL (for UAT)  
- [ ] Web designer contact (name, email) — optional  

### Staff (repeat per person)
- [ ] Full name | Email | Role (counter / manager / pharmacist / admin)  

### Integrations
- [ ] Curaleaf Rocky API username + key — or “requested, pending”  
- [ ] Worldpay merchant reference — or “pending”  

---

## 6. Staff training outline (30 minutes)

**Audience:** Pharmacy counter staff and manager  
**Goal:** Confident use of staff console for current platform phase

| Time | Topic |
|------|--------|
| 0–5 min | What HHH does; eligibility embed on their website; data confidentiality |
| 5–12 min | **Referrals tab** — new enquiry → upload records → refer to clinic → CRM confirmed |
| 12–18 min | **Create order** — sub-orders, prescription upload, formulary, margins *(if phase live)* |
| 18–24 min | **Awaiting payment** — send link, resend, Worldpay *(if phase live)* |
| 24–28 min | **Orders tab** — goods-in, ready for collection, mark collected *(if phase live)* |
| 28–30 min | Support contact; only **3 patient notifications** (pay, paid, ready); Q&A |

**After training:** confidentiality acknowledgement signed and filed (GL-07).

---

## 7. Embed instructions (give to pharmacy web designer)

The platform supports **one pattern only** — hardened iframe. Developer generates the snippet; you deliver it.

**Pharmacy web person must:**
1. Paste iframe code into eligibility page (WordPress block, HTML widget, etc.)  
2. Add **one DNS TXT record** for domain verification (Developer provides exact values)  
3. Optionally add hosted resizer script for automatic height  
4. **Not** wrap iframe in extra scripts that modify behaviour  
5. **Not** add an online medicine basket — eligibility pre-screening only (GPhC P-10)  

**If form is blank:** confirm domain verified with Developer **before** blaming web designer.

**Patient-facing URLs (for reference):**
- Eligibility embed: `portal.hhh.health/embed/eligibility/{slug}`  
- Staff console: `app.hhh.health` (never embedded on public site)  
- Patient portal (optional later): `portal.hhh.health/p/{slug}`  

---

## 8. UAT checklist & sign-off (staging — before go-live)

**Pharmacy name:** _______________________  
**Staging date:** _______________________  
**Tester (pharmacy manager):** _______________________  
**HHH Project Manager:** _______________________  

### A. Embed & eligibility (minimum for Phase 1 go-live)

| # | Test | Pass ☐ | Fail ☐ | Notes |
|---|------|--------|--------|-------|
| A1 | Eligibility iframe loads on pharmacy **staging** website | | | |
| A2 | Pharmacy name, GPhC number, address visible on form | | | |
| A3 | Privacy notice link works | | | |
| A4 | Consent checkboxes required before submit (care separate from marketing) | | | |
| A5 | Test submission appears in staff **Referrals** tab within 30 seconds | | | |
| A6 | Embed **blocked** on unlisted domain (negative test — optional) | | | |

### B. Referrals & CRM (Phase 2)

| # | Test | Pass ☐ | Fail ☐ | Notes |
|---|------|--------|--------|-------|
| B1 | Upload records / referral flow completes | | | |
| B2 | Refer to clinic — clinic reference generated | | | |
| B3 | CRM confirmed — patient appears in **Patients** tab | | | |
| B4 | Staff MFA login works | | | |

### C. Orders & payment (Phase 3 — when live)

| # | Test | Pass ☐ | Fail ☐ | Notes |
|---|------|--------|--------|-------|
| C1 | Build order with formulary products; margin warnings show | | | |
| C2 | Sub-order blocked without prescription copy attached | | | |
| C3 | Payment link sends; **Worldpay sandbox** payment completes | | | |
| C4 | Order status updates to paid | | | |

### D. Fulfillment (Phase 4 — when live)

| # | Test | Pass ☐ | Fail ☐ | Notes |
|---|------|--------|--------|-------|
| D1 | Rocky submission returns order reference (or staging mock) | | | |
| D2 | Shipment / in-transit status visible | | | |
| D3 | Goods-in → patient SMS “ready for collection” | | | |
| D4 | Mark collected completes journey | | | |

### E. Security & isolation

| # | Test | Pass ☐ | Fail ☐ | Notes |
|---|------|--------|--------|-------|
| E1 | Staff cannot see another pharmacy’s data | | | |
| E2 | Patient cannot access staff console | | | |

---

**Sign-off**

I confirm UAT sections applicable to our go-live phase have been tested and passed (or exceptions noted below).

**Pharmacy manager signature:** _______________________ **Date:** __________  
**Exceptions / follow-ups:** _______________________________________________

*(File signed copy — GL-08)*

---

## 9. Curaleaf open items to chase (TRD §9)

Email / call **Mike Baker** (cc **Phil Jones**). Block full Rocky order flow until resolved.

| # | What to confirm | Why it matters |
|---|-----------------|----------------|
| 1 | `GET /products` and `POST /prescription` API exposure + timeline | Formulary and prescription upload |
| 2 | Auth header scheme for Rocky (API key + username) | Integration |
| 3 | Full request/response schemas for all endpoints | Build |
| 4 | Max file size for prescription scan uploads | Platform limits |
| 5 | Stock status field values (green/amber/red) | UI |
| 6 | **`POST /purchase-order` — one PO with multiple prescription refs?** | **Critical architecture decision** |
| 7 | Invoice delivery (shipments vs separate endpoint) | Orders tab |
| 8 | Shipment status values + polling rate limits | Tracking |
| 9 | Per-pharmacy **test credentials** for staging | UAT |
| 10 | DPA with Curaleaf (I-03) | Legal |

---

## 10. Platform rollout phases (do not over-promise)

Confirm with Developer which phase is live **before** onboarding pharmacies.

| Phase | What works | Safe to onboard pharmacies for… | GL items required |
|-------|------------|-----------------------------------|-------------------|
| **P1 — Foundation** | Eligibility embed + submissions queue | Intake-only pilots | GL-01–08, A1–A6 UAT |
| **P2 — Clinical ops** | Referrals, Patients, CRM, audit logs | Referral workflow | + B1–B4 UAT |
| **P3 — Commerce** | Create order, Worldpay, Awaiting payment | Payment-before-order | + C1–C4, GL-10 UAT |
| **P4 — Fulfillment** | Rocky integration, Orders, collection | Full end-to-end | + D1–D4, GL-09 UAT |
| **P5 — Patient portal** | Patient self-service login, pay, collect pass | Patient-facing portal | Additional privacy notice review |

---

## 11. Open decisions (resolve with Developer tomorrow)

| # | Decision | Options | Who decides | Impact |
|---|----------|---------|-------------|--------|
| 1 | **Data controller** | Pharmacy = controller / HHH = processor (typical) vs HHH = controller | **Solicitor** | All DPAs, ICO, privacy notices |
| 2 | **Worldpay model** | Per-pharmacy merchant vs HHH aggregator | PM + solicitor + DEV | I-01, reconciliation |
| 3 | **Patient-facing brand** | HHH-branded vs white-label per pharmacy | PM + DEV | Marketing, legal |
| 4 | **First pilot pharmacy** | Which friendly site for staging UAT | PM | Timeline |
| 5 | **Go-live phase target** | P1 intake only vs wait for P4 full flow | PM + DEV | Sales promise |
| 6 | **Pricing model** | Monthly SaaS / per order / revenue share | PM | Partner agreement C-03 |

---

## 12. Tomorrow’s meeting agenda (Developer + Project Manager)

**Duration:** 60–90 minutes  
**Goal:** Assign every row in Section 3 with owner and target date

| Time | Topic | Output |
|------|-------|--------|
| 10 min | Walk Section 2 roles and hard gates — agree | Shared understanding |
| 15 min | Review **Section 3A–3C** — what’s done vs not | Company + platform task list |
| 10 min | Resolve **Section 11** open decisions where possible | Decisions logged |
| 10 min | Confirm **Section 10** current build phase | Correct pharmacy promise |
| 15 min | Assign **Section 3D** Curaleaf / Worldpay chasing | Owner + dates |
| 10 min | Plan **first pilot pharmacy** — Section 4 timeline | Target go-live month |
| 10 min | Developer: **Section 3C T-*** ETA for admin portal, embed, staging | DEV commitments |
| 10 min | Agree solicitor engagement — brief from Section 3A | PM action this week |
| 5 min | Set weekly sync cadence | Standing meeting |

**Bring to meeting:** This document printed or on screen; name of potential pilot pharmacy if known.

---

## 13. External parties & what you chase

| Party | You chase | Developer chases |
|-------|-----------|------------------|
| **Solicitor / DPO advisor** | Engagement, templates, DPIA sign-off | Technical annex, data-flow diagram |
| **Pharmacies** | Agreement, DPA, onboarding form, risk assessment, training, UAT sign-off | — |
| **Curaleaf (Mike Baker, Phil Jones)** | Section 9 open items, credentials, DPA | API integration bugs |
| **Worldpay** | Merchant accounts per I-01 | Webhooks, checkout |
| **Pharmacy web designers** | DNS TXT + embed paste | CSP issues only |
| **ICO** | HHH registration (C-05) | — |
| **AWS / Postmark / Twilio** | Sub-processor DPA copies (G-07) | Account setup |

---

## 14. Documents you must hold

### Master HHH folder (once)
- [ ] Founder / shareholder agreement (C-02)  
- [ ] Partner agreement template + each signed copy (C-03)  
- [ ] DPA template + each signed copy (G-06)  
- [ ] Controller/processor legal opinion (C-07)  
- [ ] DPIA current version (G-01)  
- [ ] ROPA (G-02)  
- [ ] Sub-processor DPAs: AWS, Worldpay, Twilio, Postmark, Curaleaf (G-07)  
- [ ] Breach procedure (G-09)  
- [ ] Retention policy (G-08)  
- [ ] Cyber Essentials certificate when ready (G-13)  
- [ ] ICO registration confirmation (C-05)  

### Per pharmacy folder
- [ ] Signed partner agreement (GL-01)  
- [ ] Signed DPA (GL-02)  
- [ ] Completed onboarding form (Section 5)  
- [ ] CBPM / distance-selling risk assessment (GL-05)  
- [ ] Professional indemnity confirmation (P-06)  
- [ ] UAT sign-off (GL-08)  
- [ ] Staff training + confidentiality log (GL-07)  
- [ ] Embed pack copy (domain, slug, date issued)  

Store securely — special category health data in contracts and forms.

---

## 15. Personal data breach — your steps (summary)

**REQ-ICO (G-09)** — full runbook from advisor; minimum:

1. **Contain** — tell Developer immediately; preserve logs  
2. **Assess** — what data, how many people, likely harm  
3. **Notify ICO within 72 hours** if risk to individuals (Developer supports facts)  
4. **Notify affected patients** if high risk to them  
5. **Record** the breach in breach log (date, nature, action taken)  
6. **Do not** admit liability in writing without solicitor  

---

## 16. Support triage (after go-live)

| Pharmacy says… | You do | Escalate to Developer? |
|----------------|--------|------------------------|
| How do I refer a patient? | Training / resend quick-ref | No |
| Form blank on website | Check embed published; domain verified | Yes if verified |
| Payment link didn’t work | Confirm patient email; resend link | Yes if resend fails |
| Order stuck in transit | Explain 5-min polling delay | Yes if >24h stuck |
| New staff login needed | Collect email; request invite | Yes (admin portal) |
| Patient wants data deleted | Log request; follow G-10 procedure | Yes for execution |
| Suspected data breach | Section 15 immediately | Yes immediately |

**Cadence:** Daily inbox scan when live · Weekly onboarding pipeline · 48h post-go-live call · Monthly partner check-in · Annual ICO renewal + DPIA review.

---

## 17. What you must never do

- Go live without signed **partner agreement + DPA**  
- Copy-paste DPAs from the internet for health data  
- Send **marketing** SMS/email without separate PECR consent  
- Promise full order flow if platform is only Phase 1 intake  
- Guess controller/processor roles — **solicitor only**  
- Store patient data in personal email or unsecured drives  
- Give pharmacy Rocky API keys or Worldpay secrets to paste on their website  

---

## 18. What the Developer must deliver (your checklist to verify)

Before saying “yes” to go-live for each phase:

- [ ] Staging tenant works end-to-end for that phase  
- [ ] Production environment separate from staging  
- [ ] MFA enforced for all staff  
- [ ] Embed CSP blocks unverified domains  
- [ ] Privacy notice + consent live on embed  
- [ ] No card data touches HHH servers  
- [ ] You can receive a test submission on staging without Developer help  
- [ ] Admin portal or manual process documented for: new staff invite, embed pack, domain verify  

---

## 19. Quick reference — the three patient notifications only

| # | When | Channel | You approve copy |
|---|------|---------|------------------|
| 1 | Payment link sent | Email and/or SMS | ☐ G-12 |
| 2 | Payment confirmed | Email and/or SMS (often via Worldpay) | ☐ G-12 |
| 3 | Ready for collection | SMS and/or email | ☐ G-12 |

No other automated patient messaging without legal review.

---

*This document supersedes cross-references for go-live planning. Technical architecture detail: `production-architecture.md`. Full regulatory ID register: `uk-compliance-register.md`.*
