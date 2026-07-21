# UK Compliance & Requirements Register

> **Surface decision update:** The eligibility form is centrally hosted by HHH and reached through pharmacy-specific links/QR codes. Earlier “embed” wording should be read as referring to this hosted eligibility surface; iframe-specific requirements are superseded by `ADR-hosted-form-link-out.md`.

**Status:** Living register — align all go-live gates to this document  
**Applies to:** Healius Consulting as platform operator, the HHH platform/brand, pharmacy tenants, and onboarding
**Related:** `production-architecture.md`, `project-manager-playbook.md`

This register labels every requirement using the legend below. Items marked **REQ-UK**, **REQ-ICO**, or **REQ-GPHC** must be satisfied (or explicitly owned by the pharmacy with evidence on file) before live patient data is processed.

### Operator identity boundary

| Field | Current record |
|-------|----------------|
| Operating/business name evidenced in correspondence | **Healius Consulting** |
| Platform/product brand | **HHH (Holistic Health Hub)** |
| Website/contact domain | `healiusconsulting.com` |
| Exact registered legal name and legal form | **OPEN — Shaylen must confirm from incorporation/registration records** |
| Company number and registered office (if incorporated) | **OPEN** |
| Contracting party, ICO fee payer and insured entity | The verified legal entity operating as Healius Consulting; **not “HHH Ltd” unless that exact entity is confirmed** |

**PRE-LIVE:** HHH may remain the patient-facing product name, but every contract, privacy notice, DPA, supplier account, insurance policy and statutory disclosure must use the verified legal entity name and explain its relationship to the HHH brand.

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
| **GPhC distance selling guidance** | Centrally hosted eligibility form, linked from pharmacy websites, plus the patient portal | [Distance selling guidance (Feb 2025)](https://www.pharmacyregulation.org/guidance/standards-and-guidance/guidance-for-registered-pharmacies-providing-pharmacy-services-at-a-distance-including-on-the-internet) |
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
| Eligibility pre-screening (centrally hosted public form) | **Art. 9(2)(a) explicit consent** | Consent must be specific, informed, granular; health data needs explicit consent |
| CRM, orders, dispensing workflow | **Art. 9(2)(h) health or social care** | DPA 2018 Sch. 1 Pt. 1 para. 2; Art. 9(3) — processing under responsibility of health professional subject to duty of confidentiality (pharmacist) |
| Marketing (non-essential) | **Art. 9(2)(a) explicit consent** or do not process | Separate from care consent; PECR soft opt-in rules for email/SMS |

**REQ-LEGAL:** Solicitor confirms Article 6 + Article 9 pairing for controller and processor in the DPA and privacy notices.

**REQ-ICO:** Where relying on DPA 2018 Schedule 1 conditions, maintain an **Appropriate Policy Document** ([ICO guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-an-appropriate-policy-document/)).

---

## 2. Master requirements checklist

### 2.1 Operator, ownership & contracting identity (before first partner)

| ID | Label | Requirement | Owner | Status |
|----|-------|-------------|-------|--------|
| C-01 | **REQ-LEGAL** | Verify the exact legal entity behind the **Healius Consulting** business name and **HHH** platform: legal name, legal form/status, company number (if any), registered office and authority to contract | Shaylen / solicitor | ☐ |
| C-02 | **REQ-LEGAL** | Founder / shareholder agreement where applicable, plus evidence that the operator owns or is licensed to use the HHH name, domains, software and content | PM / solicitor | ☐ |
| C-03 | **REQ-LEGAL** | Partner agreement template (pharmacy ↔ verified Healius legal entity, trading as HHH) | Solicitor; PM runs signing | ☐ |
| C-04 | **REQ-LEGAL** | DPA template + controller/processor opinion | Solicitor | ☐ |
| C-05 | **REQ-UK** | ICO fee registration under the verified operator legal name, if required for its controller/processor activities | PM | ☐ |
| C-06 | **REC-UK** | Professional indemnity + cyber insurance held by the verified operator and expressly covering the HHH platform/service | PM | ☐ |
| C-07 | **OPEN** | **PRE-BUILD:** Data controller model (pharmacy vs verified Healius legal entity operating HHH) | Solicitor | ☐ |
| C-08 | **REQ-LEGAL** | Website, email footer, terms, invoices and privacy notices display the required legal identity and trading-name disclosures | Solicitor / PM / DEV | ☐ |

### 2.2 ICO / UK GDPR accountability (before first live patient)

| ID | Label | Requirement | Owner | UK reference | Status |
|----|-------|-------------|-------|--------------|--------|
| G-01 | **REQ-ICO** | **DPIA** completed (high risk: special category + innovative tech + online access) | PM + advisor; DEV technical input | [ICO DPIA guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-impact-assessments/) | ☐ |
| G-02 | **REQ-ICO** | **Record of Processing Activities (ROPA)** | PM + advisor | UK GDPR Art. 30 | ☐ |
| G-03 | **REQ-UK** | **Privacy notices** — hosted eligibility form, patient portal, staff and pharmacy-facing; each names the verified Healius legal entity, contact details and controller/processor roles | Solicitor; PM publishes | UK GDPR Arts. 13–14 | ☐ |
| G-04 | **REQ-UK** | **Explicit consent** capture on eligibility form (care vs marketing separate) | DEV builds; solicitor drafts wording | Art. 9(2)(a) where consent route used | ☐ |
| G-05 | **REQ-ICO** | **Appropriate Policy Document** (if Sch. 1 Art. 9 condition used) | Solicitor / advisor | DPA 2018 | ☐ |
| G-06 | **REQ-UK** | **DPA** signed: verified Healius legal entity (operator of HHH) ↔ each pharmacy | PM | Art. 28 | ☐ |
| G-07 | **REQ-UK** | **Sub-processor DPAs:** relevant supplier agreements are held in the verified operator name and cover AWS/hosting, Worldpay, communications services and Curaleaf as applicable | PM obtains; solicitor reviews | Art. 28(2)–(4) | ☐ |
| G-08 | **REQ-ICO** | **Data retention & deletion policy** (documented + automated where possible) | DEV implements; advisor approves schedule | Storage limitation principle | ☐ |
| G-09 | **REQ-ICO** | **Personal data breach procedure** (72h ICO notification where required) | PM + advisor; DEV technical response | UK GDPR Arts. 33–34 | ☐ |
| G-10 | **REQ-ICO** | **Individual rights procedure** (access, erasure, rectification, portability) | DEV builds; PM process | UK GDPR Art. 15–22 | ☐ |
| G-11 | **REQ-UK** | **PECR:** cookie consent on hosted form/portal if non-essential cookies are used | DEV; solicitor wording | PECR Reg. 6 | ☐ |
| G-12 | **REQ-UK** | **PECR / UK GDPR:** SMS/email only with valid consent or soft opt-in rules | PM templates; DEV | PECR + marketing guidance | ☐ |
| G-13 | **REC-UK** | **Cyber Essentials** certification | DEV / PM | NCSC scheme | ☐ |
| G-14 | **REC-UK** | Annual DPIA review + penetration test | PM schedules; DEV remediates | ICO accountability | ☐ |

### 2.3 GPhC & pharmacy professional (pharmacy tenant — platform must enable)

| ID | Label | Requirement | Owner | UK reference | Status |
|----|-------|-------------|-------|--------------|--------|
| P-01 | **REQ-GPHC** | Valid **GPhC registration** recorded for tenant | PM collects | GPhC standards | ☐ |
| P-02 | **REQ-GPHC** | **Superintendent Pharmacist** named on patient-facing surfaces | PM collects; DEV displays | Distance selling guidance | ☐ |
| P-03 | **REQ-GPHC** | **Pharmacy name, address, GPhC number** on hosted form + portal | DEV displays per tenant | Distance selling guidance | ☐ |
| P-04 | **REQ-GPHC** | **CBPM risk assessment** (pharmacy-owned document) covering online intake → collection | Pharmacy; PM verifies exists | CBPM thematic review | ☐ |
| P-05 | **REQ-GPHC** | **Staff training** on CBPM, confidentiality, platform use | PM delivers; pharmacy RP sign-off | GPhC standards — staff | ☐ |
| P-06 | **REQ-GPHC** | **Professional indemnity** arrangements for pharmacy | Pharmacy; PM confirms | Distance selling guidance | ☐ |
| P-07 | **REQ-GPHC** | **Controlled drugs** secure storage & CD register (physical premises) | Pharmacy | Misuse of Drugs Regs | ☐ |
| P-08 | **REQ-GPHC** | **Prescription verification** before supply (valid prescriber, specialist where required) | Pharmacy workflow in platform | CBPM + HMR 2012 | ☐ |
| P-09 | **REC-UK** | **SCR / clinical record access** where available for screening | Pharmacy | GPhC CBPM review recommendation | ☐ |
| P-10 | **REQ-GPHC** | Website/link-out must **not** allow ordering medicines without the prescription pathway | DEV — eligibility only, no medicine basket on public form | Distance selling guidance | ☐ |

### 2.4 Platform security & technical (Developer)

| ID | Label | Requirement | Owner | Status |
|----|-------|-------------|-------|--------|
| T-01 | **REQ-PLATFORM** | UK/EU data residency for patient data (London region) | DEV | ☐ |
| T-02 | **REQ-PLATFORM** | Encryption in transit (TLS 1.2+) and at rest | DEV | ☐ |
| T-03 | **REQ-PLATFORM** | Multi-tenant isolation (RLS / middleware) | DEV | ☐ |
| T-04 | **REQ-PLATFORM** | Staff MFA; patient magic link / OTP | DEV | ☐ |
| T-05 | **REQ-PLATFORM** | Audit logs for patient data access | DEV | ☐ |
| T-06 | **REQ-PLATFORM** | Hosted eligibility form protected by TLS, CSP, rate limiting, bot controls, token validation and revocation | DEV | ☐ |
| T-07 | **REQ-UK** | No card data on platform — **Worldpay hosted checkout only** | DEV | ☐ |
| T-08 | **REQ-PLATFORM** | Prescription scans: private S3, signed URLs, short TTL | DEV | ☐ |
| T-09 | **REQ-PLATFORM** | Rocky API keys in Secrets Manager only | DEV | ☐ |
| T-10 | **REC-UK** | WCAG 2.2 AA patient-facing UI | DEV | ☐ |
| T-11 | **REQ-PLATFORM** | Automated retention / deletion jobs per policy G-08 | DEV | ☐ |
| T-12 | **REQ-PLATFORM** | Admin portal: tenant provisioning, modular features, branding, token rotation and link/QR content pack | DEV | ☐ |
| T-13 | **REQ-ICO** | Healius Consulting HHH cross-tenant patient access limited to authorised support roles, minimum necessary data and immutable access logs | DEV + DPO adviser | ☐ |
| T-14 | **REQ-PLATFORM** | Each pharmacy's Worldpay connection is configured server-side; no merchant secrets, card details or bank credentials are exposed to browsers | DEV | ☐ |
| T-15 | **REQ-PLATFORM** | HHH programme-onboarding decisions require a logged patient call and record the named approver, time, outcome and reason; approved patients are released only to their token-attributed pharmacy | DEV + Shaylen | ☐ |
| T-16 | **REQ-GPHC** | HHH onboarding approval is not treated as diagnosis or prescribing authority; payment and Curaleaf submission remain blocked until a valid doctor-issued prescription and pharmacy checks are recorded | DEV + pharmacy | ☐ |

### 2.5 Integrations & external (before full order flow)

| ID | Label | Requirement | Owner | Status |
|----|-------|-------------|-------|--------|
| I-01 | **OPEN** | **PRE-LIVE:** Worldpay confirms the supported per-pharmacy merchant onboarding model and that patient funds can settle directly to the attributed pharmacy | PM + solicitor | ☐ |
| I-02 | **OPEN** | **PRE-BUILD:** Curaleaf TRD §9 open items closed | PM chases; DEV builds | ☐ |
| I-03 | **REQ-LEGAL** | DPA with Curaleaf | PM | ☐ |
| I-04 | **REQ-PM** | Rocky credentials per pharmacy | PM → DEV | ☐ |
| I-05 | **REQ-PM** | Worldpay merchant connection live for each pharmacy using online payment | PM → DEV | ☐ |
| I-06 | **OPEN** | Direct-settlement operating rules cover merchant onboarding, reconciliation, VAT, refunds, chargebacks and reserves; HHH's separate platform subscription is documented in the partner agreement | PM + Worldpay + solicitor | ☐ |
| I-07 | **REQ-PLATFORM** | Payment webhooks are signed, idempotent and reconciled to the pharmacy tenant before status updates | DEV | ☐ |

### 2.6 Per-pharmacy go-live gate (**PRE-LIVE**)

All must be ☑ before production tenant activation:

| ID | Requirement |
|----|-------------|
| GL-01 | C-03 partner agreement signed for this pharmacy |
| GL-02 | G-06 DPA signed for this pharmacy |
| GL-03 | G-01 DPIA covers this integration (or pharmacy addendum filed) |
| GL-04 | P-01–P-03 GPhC details live on hosted form/portal |
| GL-05 | P-04 CBPM risk assessment on file |
| GL-06 | Pharmacy token tested; hosted link, QR code and content pack issued |
| GL-07 | Staff trained + confidentiality acknowledged |
| GL-08 | Staging UAT signed by pharmacy manager |
| GL-09 | I-04 Rocky credentials configured (when order flow live) |
| GL-10 | I-05/I-06 Worldpay merchant connected, settlement destination verified and live mode approved |

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
