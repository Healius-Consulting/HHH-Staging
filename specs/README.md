# Holistic Health Hub × Curaleaf — Medical Cannabis Platform

Working **prototype and technical specification** for the Holistic Health Hub (HHH) medical-cannabis service platform, which integrates with Curaleaf Laboratories' **"Rocky"** REST API for B2B ordering. This repository is the brief for building the production application.

> **Status:** Prototype + requirements. The `.html` files are clickable, **in-memory mockups (no backend)** that serve as the functional spec. The production app is still to be built.

## The end-to-end journey

Referral / eligibility intake → clinic referral (Curaleaf Clinic) → prescription issued → ordering from Curaleaf (Rocky API) → patient payment (Worldpay) → dispensing & **collection at the pharmacy**.

## What's in here

| File | What it is |
|------|------------|
| `HHH-Ordering-Platform-Prototype.html` | The main clickable prototype — the staff/pharmacy platform. **Open in a browser.** Tabs: Home (dashboard), Referrals (intake), Formulary, Create order, Awaiting payment, Orders, Patients. |
| `HHH-Eligibility-Form.html` | The patient-facing eligibility form (the replacement for the external pharmsmart "add-patient" page). **Open in a browser.** |
| `HHH-Ordering-Platform-Mockup.svg` | Static visual mockup of the ordering screen. |
| `Rocky_API_Technical_Requirements_v1.5.docx` | The Technical Requirements Document (TRD) — 52 functional requirements (F-01–F-52), API endpoints, expected payloads, non-functional requirements, and open items. |
| `TRD-redline-Rx-suborder-flow.md`, `TRD-redline-patient-payment.md` | Requirement redlines pending merge into the TRD. |
| `production-architecture.md` | Production architecture — hosting (frontend, backend, UK infra), security, hardened embed model, integrations, and the full pharmacy onboarding playbook (legal → go-live). |
| `full_project_breakdown.md` | Technical breakdown of the current React prototype — file-by-file map of clinician/patient portals, state schemas, and static spec assets. |
| `project-manager-playbook.md` | **Self-contained go-live guide** for Project Manager (Owner) — master checklists, per-pharmacy runbook, onboarding form, UAT sign-off, meeting agenda, Curaleaf chase list. Use this alone for pre-go-live task breakdown. |
| `uk-compliance-register.md` | **Master UK requirements register** — labelled checklist (REQ-UK, REQ-ICO, REQ-GPHC, PRE-LIVE gates) with ICO/GPhC/DPA 2018 references. |

## How to view

**React SPA prototype** (`src/`): run `npm install && npm run dev`, then open the Vite dev URL. Portal gateway → clinician or patient console; in-memory state resets on refresh.

**Static HTML specs** (`specs/*.html`): open **directly in a browser** — no server needed. State is in-memory; seed data is included so every flow is explorable.

## Key architecture & decisions

- An **order** = one or more prescription **sub-orders**; each sub-order = one uploaded prescription copy + its line items. Curaleaf reviews the prescription copy before approving each sub-order.
- **One payment link per patient** (Worldpay), covering all of that patient's prescriptions. The patient pays **before** stock is ordered from Curaleaf (reduces unused-medication risk).
- Each prescription is placed and tracked **individually** with Curaleaf. Hybrid **auto-place on payment** with a stock/price re-check; a held-for-review path on failure; placement can be undone until Curaleaf approves.
- **Collection** model — the patient collects from the pharmacy (not home delivery). The Curaleaf→pharmacy dispatch (courier, notably DPD) is internal; "ready for collection" is triggered by pharmacy **goods-in**.
- Patient notifications are limited to **three**: request to pay, payment confirmation (both via Worldpay), and "ready for collection" (via a connected SMS/email app).
- Each pharmacy has a **unique eligibility form / QR** (token in the URL routes submissions to that pharmacy). An admin (all-pharmacy) view is planned.

## Integrations the production build will need

- **Curaleaf Rocky API** — `GET /products`, `POST /prescription`, `POST /purchase-order`, `GET /shipments` (polling; **no webhooks**). Auth: per-pharmacy API key + username pair.
- **Worldpay** — hosted payment + webhooks for pay/paid status.
- **HHH CRM** — referred-patient records (the prototype mocks this).
- **SMS / email provider** — the "ready for collection" notification.
- **File storage** for prescription scans — special-category health data (UK GDPR Art. 9); encryption + retention rules apply.

## Open items (pending Curaleaf confirmation)

Several Rocky API details are not yet locked — see TRD §9. Most notably: whether `POST /purchase-order` accepts multiple `prescription_refs` (consolidated vs one PO per prescription), the auth header scheme, the `GET /products` response schema + exact stock-status values, scan max file size, shipment status set, and how delivery/goods-in is reported. An email requesting these has been sent to Curaleaf (Mike Baker / Phil Jones).

## Notes for scoping

- These are **functional specs, not production code** — single-file HTML with in-memory state. They demonstrate flows, logic, and gating; they are not the architecture.
- A fuller project hub (decision log, open-items tracker, improvement backlog) is maintained in Notion and can be shared separately.

---
Prepared by Shaylen Patel · Holistic Health Hub
