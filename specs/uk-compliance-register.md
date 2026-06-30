# UK Compliance & Requirements Register

**Status:** Living register — align all go-live gates to this document  
**Applies to:** HHH platform, pharmacy tenants, and onboarding  
**Related:** `production-architecture.md`, `project-manager-playbook.md`

This register labels every requirement using the legend below. Items marked **REQ-UK**, **REQ-ICO**, or **REQ-GPHC** must be satisfied (or explicitly owned by the pharmacy with evidence on file) before live patient data is processed.

---

## Requirement labels

| Label | Meaning |
|-------|---------|
| **REQ-UK** | Required by UK law (UK GDPR, DPA 2018, or other statute) |
| **REQ-ICO** | Required UK GDPR accountability measure per [ICO guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/) |
| **REQ-GPHC** | Required under [GPhC Standards for Registered Pharmacies](https://www.pharmacyregulation.org/standards/standards-for-registered-pharmacies) or GPhC thematic guidance (pharmacy tenant responsibility; platform must support) |
| **REQ-LEGAL** | Required legal document or opinion — solicitor / DPO advisor |
| **REQ-PLATFORM** | Required for secure, auditable platform operation (Developer) |
| **REQ-PM** | Required action — Project Manager (Owner) |
| **REQ-DEV** | Required action — Developer |
| **REC-UK** | Recommended UK best practice (not always mandatory but expected by partners/regulators) |
| **OPEN** | Decision or external confirmation still outstanding |
| **PRE-BUILD** | Must be resolved before production build finalised |
| **PRE-LIVE** | Must be complete before first live patient |

---

## 1. UK regulatory framework (reference)

| Framework | Relevance to this platform | Primary guidance |
|-----------|---------------------------|------------------|
| **UK GDPR** (retained EU law) | All personal data processing | [ICO UK GDPR hub](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/) |
| **Data Protection Act 2018** | Schedule 1 conditions for special category data; law enforcement; exemptions | [Legislation.gov.uk DPA 2018](https://www.legislation.gov.uk/ukpga/2018/12/contents) |
| **ICO registration** | Data controllers (and some processors) pay fee | [ICO registration](https://ico.org.uk/for-organisations/data-protection-fee/) |
| **GPhC Standards** | Pharmacy tenants supplying CBPMs and distance services | [GPhC standards](https://www.pharmacyregulation.org/standards/standards-for-registered-pharmacies) |
| **GPhC distance selling guidance** | Eligibility embed + patient portal on pharmacy websites | [Distance selling guidance (Feb 2025)](https://www.pharmacyregulation.org/guidance/standards-and-guidance/guidance-for-registered-pharmacies-providing-pharmacy-services-at-a-distance-including-on-the-internet) |
| **GPhC CBPM thematic review** | Cannabis-based products for medicinal use — governance, premises, CD storage | [CBPM review (Oct 2025)](https://www.pharmacyregulation.org/about-us/news-and-updates/gphc-publishes-themed-review-pharmacies-providing-cannabis-based-products-medicinal-use) |
| **Misuse of Drugs Regulations 2001** | Schedule 2 CBPMs — CD register, secure storage, RP accountability | Pharmacy tenant (platform supports audit trail only) |
| **Human Medicines Regulations 2012** | Supply against valid prescription | Pharmacy + prescriber workflow |
| **PECR** | Cookies, electronic marketing (SMS/email) | [ICO PECR guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/) |
| **Equality Act 2010** | Service accessibility | **REC-UK:** WCAG 2.2 AA for patient-facing surfaces |
| **PCI DSS** | Card data | **REQ-UK** scope avoided via Worldpay hosted checkout only |
| **Cyber Essentials** | Supplier assurance | **REC-UK** — commonly requested by pharmacy partners |

### Special category (health) data — lawful basis

Processing health data requires **both**:

1. **Article 6 lawful basis** (e.g. contract, legitimate interests, legal obligation) — [ICO Article 6 guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/)  
2. **Article 9 condition** for special category data — [ICO Article 9 guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/)

Likely conditions for this platform ( **OPEN — solicitor must confirm per role** ):

| Processing activity | Likely Art. 9 condition | UK law / notes |
|--------------------|-------------------------|----------------|
| Eligibility pre-screening (public embed) | **Art. 9(2)(a) explicit consent** | Consent must be specific, informed, granular; health data needs explicit consent |
| CRM, orders, dispensing workflow | **Art. 9(2)(h) health or social care** | DPA 2018 Sch. 1 Pt. 1 para. 2; Art. 9(3) — processing under responsibility of health professional subject to duty of confidentiality (pharmacist) |
| Marketing (non-essential) | **Art. 9(2)(a) explicit consent** or do not process | Separate from care consent; PECR soft opt-in rules for email/SMS |

**REQ-LEGAL:** Solicitor confirms Article 6 + Article 9 pairing for controller and processor in the DPA and privacy notices.

**REQ-ICO:** Where relying on DPA 2018 Schedule 1 conditions, maintain an **Appropriate Policy Document** ([ICO guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-an-appropriate-policy-document/)).

---

## 2. Master requirements checklist

### 2.1 Company & founder (before first partner)

| ID | Label | Requirement | Owner | Status |
|----|-------|-------------|-------|--------|
| C-01 | **REQ-LEGAL** | HHH Ltd incorporated | PM / directors | ☐ |
| C-02 | **REQ-LEGAL** | Founder / shareholder agreement | PM / solicitor | ☐ |
| C-03 | **REQ-LEGAL** | Partner agreement template (pharmacy ↔ HHH) | Solicitor; PM runs signing | ☐ |
| C-04 | **REQ-LEGAL** | DPA template + controller/processor opinion | Solicitor | ☐ |
| C-05 | **REQ-UK** | HHH ICO registration (if advised as controller/processor) | PM | ☐ |
| C-06 | **REC-UK** | Professional indemnity + cyber insurance | PM | ☐ |
| C-07 | **OPEN** | **PRE-BUILD:** Data controller model (pharmacy vs HHH) | Solicitor | ☐ |

### 2.2 ICO / UK GDPR accountability (before first live patient)

| ID | Label | Requirement | Owner | UK reference | Status |
|----|-------|-------------|-------|--------------|--------|
| G-01 | **REQ-ICO** | **DPIA** completed (high risk: special category + innovative tech + online access) | PM + advisor; DEV technical input | [ICO DPIA guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-impact-assessments/) | ☐ |
| G-02 | **REQ-ICO** | **Record of Processing Activities (ROPA)** | PM + advisor | UK GDPR Art. 30 | ☐ |
| G-03 | **REQ-UK** | **Privacy notices** — patient (embed + portal), staff, pharmacy-facing | Solicitor; PM publishes | UK GDPR Arts. 13–14 | ☐ |
| G-04 | **REQ-UK** | **Explicit consent** capture on eligibility form (care vs marketing separate) | DEV builds; solicitor drafts wording | Art. 9(2)(a) where consent route used | ☐ |
| G-05 | **REQ-ICO** | **Appropriate Policy Document** (if Sch. 1 Art. 9 condition used) | Solicitor / advisor | DPA 2018 | ☐ |
| G-06 | **REQ-UK** | **DPA** signed: HHH ↔ each pharmacy | PM | Art. 28 | ☐ |
| G-07 | **REQ-UK** | **Sub-processor DPAs:** AWS, Worldpay, Twilio, Postmark, Curaleaf | PM obtains; solicitor reviews | Art. 28(2)–(4) | ☐ |
| G-08 | **REQ-ICO** | **Data retention & deletion policy** (documented + automated where possible) | DEV implements; advisor approves schedule | Storage limitation principle | ☐ |
| G-09 | **REQ-ICO** | **Personal data breach procedure** (72h ICO notification where required) | PM + advisor; DEV technical response | UK GDPR Arts. 33–34 | ☐ |
| G-10 | **REQ-ICO** | **Individual rights procedure** (access, erasure, rectification, portability) | DEV builds; PM process | UK GDPR Art. 15–22 | ☐ |
| G-11 | **REQ-UK** | **PECR:** cookie consent on embed/portal if non-essential cookies used | DEV; solicitor wording | PECR Reg. 6 | ☐ |
| G-12 | **REQ-UK** | **PECR / UK GDPR:** SMS/email only with valid consent or soft opt-in rules | PM templates; DEV | PECR + marketing guidance | ☐ |
| G-13 | **REC-UK** | **Cyber Essentials** certification | DEV / PM | NCSC scheme | ☐ |
| G-14 | **REC-UK** | Annual DPIA review + penetration test | PM schedules; DEV remediates | ICO accountability | ☐ |

### 2.3 GPhC & pharmacy professional (pharmacy tenant — platform must enable)

| ID | Label | Requirement | Owner | UK reference | Status |
|----|-------|-------------|-------|--------------|--------|
| P-01 | **REQ-GPHC** | Valid **GPhC registration** recorded for tenant | PM collects | GPhC standards | ☐ |
| P-02 | **REQ-GPHC** | **Superintendent Pharmacist** named on patient-facing surfaces | PM collects; DEV displays | Distance selling guidance | ☐ |
| P-03 | **REQ-GPHC** | **Pharmacy name, address, GPhC number** on embed + portal | DEV displays per tenant | Distance selling guidance | ☐ |
| P-04 | **REQ-GPHC** | **CBPM risk assessment** (pharmacy-owned document) covering online intake → collection | Pharmacy; PM verifies exists | CBPM thematic review | ☐ |
| P-05 | **REQ-GPHC** | **Staff training** on CBPM, confidentiality, platform use | PM delivers; pharmacy RP sign-off | GPhC standards — staff | ☐ |
| P-06 | **REQ-GPHC** | **Professional indemnity** arrangements for pharmacy | Pharmacy; PM confirms | Distance selling guidance | ☐ |
| P-07 | **REQ-GPHC** | **Controlled drugs** secure storage & CD register (physical premises) | Pharmacy | Misuse of Drugs Regs | ☐ |
| P-08 | **REQ-GPHC** | **Prescription verification** before supply (valid prescriber, specialist where required) | Pharmacy workflow in platform | CBPM + HMR 2012 | ☐ |
| P-09 | **REC-UK** | **SCR / clinical record access** where available for screening | Pharmacy | GPhC CBPM review recommendation | ☐ |
| P-10 | **REQ-GPHC** | Website must **not** allow ordering medicines without prescription pathway | DEV — eligibility only, no basket on embed | Distance selling guidance | ☐ |

### 2.4 Platform security & technical (Developer)

| ID | Label | Requirement | Owner | Status |
|----|-------|-------------|-------|--------|
| T-01 | **REQ-PLATFORM** | UK/EU data residency for patient data (London region) | DEV | ☐ |
| T-02 | **REQ-PLATFORM** | Encryption in transit (TLS 1.2+) and at rest | DEV | ☐ |
| T-03 | **REQ-PLATFORM** | Multi-tenant isolation (RLS / middleware) | DEV | ☐ |
| T-04 | **REQ-PLATFORM** | Staff MFA; patient magic link / OTP | DEV | ☐ |
| T-05 | **REQ-PLATFORM** | Audit logs for patient data access | DEV | ☐ |
| T-06 | **REQ-PLATFORM** | Hardened iframe embed + `frame-ancestors` CSP | DEV | ☐ |
| T-07 | **REQ-UK** | No card data on platform — **Worldpay hosted checkout only** | DEV | ☐ |
| T-08 | **REQ-PLATFORM** | Prescription scans: private S3, signed URLs, short TTL | DEV | ☐ |
| T-09 | **REQ-PLATFORM** | Rocky API keys in Secrets Manager only | DEV | ☐ |
| T-10 | **REC-UK** | WCAG 2.2 AA patient-facing UI | DEV | ☐ |
| T-11 | **REQ-PLATFORM** | Automated retention / deletion jobs per policy G-08 | DEV | ☐ |
| T-12 | **REQ-PLATFORM** | Admin portal: tenant provisioning, domain verify, embed pack | DEV | ☐ |

### 2.5 Integrations & external (before full order flow)

| ID | Label | Requirement | Owner | Status |
|----|-------|-------------|-------|--------|
| I-01 | **OPEN** | **PRE-BUILD:** Worldpay model (per-pharmacy vs HHH merchant) | PM + solicitor | ☐ |
| I-02 | **OPEN** | **PRE-BUILD:** Curaleaf TRD §9 open items closed | PM chases; DEV builds | ☐ |
| I-03 | **REQ-LEGAL** | DPA with Curaleaf | PM | ☐ |
| I-04 | **REQ-PM** | Rocky credentials per pharmacy | PM → DEV | ☐ |
| I-05 | **REQ-PM** | Worldpay merchant live per agreed model | PM → DEV | ☐ |

### 2.6 Per-pharmacy go-live gate (**PRE-LIVE**)

All must be ☑ before production tenant activation:

| ID | Requirement |
|----|-------------|
| GL-01 | C-03 partner agreement signed for this pharmacy |
| GL-02 | G-06 DPA signed for this pharmacy |
| GL-03 | G-01 DPIA covers this integration (or pharmacy addendum filed) |
| GL-04 | P-01–P-03 GPhC details live on embed/portal |
| GL-05 | P-04 CBPM risk assessment on file |
| GL-06 | Domain verified; embed pack issued |
| GL-07 | Staff trained + confidentiality acknowledged |
| GL-08 | Staging UAT signed by pharmacy manager |
| GL-09 | I-04 Rocky credentials configured (when order flow live) |
| GL-10 | I-05 Worldpay live (when payment flow live) |

---

## 3. Suggested data retention (for legal review)

**REQ-LEGAL:** Solicitor/advisor must approve final periods.

| Data type | Suggested retention | Deletion method |
|-----------|--------------------|-----------------|
| Eligibility submission (not progressed) | 12 months | Automated job |
| CRM patient (active) | Duration of care + 8 years | Manual review + automated archive |
| Prescription scans | 8 years from last supply (pharmacy record-keeping norm) | S3 lifecycle + DB flag |
| Payment records | 7 years (tax/reconciliation) | Archive |
| Audit logs | 7 years minimum | Immutable store |
| Draft orders (unpaid) | 24 hours | Automated (TRD F-26) |

---

## 4. Document map

| Document | Purpose |
|----------|---------|
| `uk-compliance-register.md` | **This file** — master labelled checklist |
| `production-architecture.md` | Technical architecture + labelled technical requirements |
| `project-manager-playbook.md` | PM operations + labelled legal/onboarding requirements |
| `Rocky_API_Technical_Requirements_v1.5.docx` | Functional requirements F-01–F-52 |
| DPIA (external) | To be created — not in repo |
| Privacy notices (external) | Solicitor-drafted — not in repo |

---

*Review quarterly or when ICO/GPhC guidance changes. Last structured against GPhC distance selling (Feb 2025) and CBPM thematic review (Oct 2025).*
