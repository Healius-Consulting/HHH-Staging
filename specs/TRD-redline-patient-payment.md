# TRD addition: patient payment & HHH CRM integration

Proposed requirements for the patient-payment feature. Intended for merge into the TRD as v1.6, with consecutive F-ID renumbering on merge. Suggested new section **6.9 Patient Payment** plus edits to the sub-order and order-placement requirements.

## Concept

The pharmacy must collect payment from the patient before stock is ordered from Curaleaf, to reduce the risk of unused (and unpaid-for) controlled medication. A patient enters the pharmacy ordering CRM only after completing the pharmacy-token eligibility form and receiving an audited programme-onboarding approval from Holistic Health Hub following Shaylen's telephone review. This is an administrative onboarding gate, not a diagnosis or prescription. The ordering system then requires a valid doctor-issued prescription before payment can be requested or a Curaleaf order placed. Payment is per prescription sub-order, because each sub-order belongs to a single patient.

End-to-end flow: pharmacy-token enquiry → HHH telephone review → HHH approves programme onboarding → doctor issues prescription → pharmacy links the HHH-approved patient and uploads/verifies the prescription → staff set prices and choose Worldpay online or pharmacy-managed payment → payment is verified → the order passes through HHH to Curaleaf.

Two payment routes are supported:

1. **Worldpay online:** HHH creates a hosted checkout session against the attributed pharmacy's connected Worldpay merchant account. Only a verified server-side Worldpay webhook may mark the payment paid. Patient funds settle directly to that pharmacy.
2. **Pharmacy-managed:** The pharmacy takes payment through its own EPOS/till/banking process (including EPOS card, cash, bank transfer or other) and a staff member manually confirms receipt. The record captures tender type, amount, confirmation time, staff actor, optional invoice/receipt reference and optional notes.

HHH does not take a percentage of prescription sales. The pharmacy's platform subscription fee is agreed and invoiced separately from patient payments.

## New functional requirements (section 6.9 Patient Payment)

- **F-NN — CRM patient lookup.** When building a sub-order, the pharmacist must be able to search the HHH CRM and link a referred patient. On linking, the patient's name, email, mobile, and address must populate the sub-order without manual re-entry.
- **F-NN — HHH onboarding gate.** Only HHH administrators may approve or decline programme onboarding. Approval requires a logged patient call and records the decision time, named approver and reason. Only approved patients are released into the attributed pharmacy CRM. The screen must state that this gate does not replace clinical diagnosis, prescribing or pharmacy professional checks.
- **F-NN — One patient per sub-order.** Each prescription sub-order must be associated with exactly one CRM patient record.
- **F-NN — Patient charge calculation.** The amount payable by the patient must be the sum of the pharmacy-controlled price of each line item plus the pharmacy-controlled delivery charge and any approved dispensing fee.
- **F-NN — Pharmacy pricing control.** Authorised pharmacy staff may set prescription line-item prices and configure their own enabled delivery options and charges. Existing paid orders retain immutable price snapshots. HHH administrators may view pricing for support and audit but may not dictate prescription sale prices.
- **F-NN — Separate platform subscription.** HHH's platform fee is configured and invoiced separately to the pharmacy. It must not be calculated from, deducted from or recorded as a share of patient payments.
- **F-NN — Send payment link.** The pharmacist must be able to send the patient a secure payment link for the sub-order via email, SMS, or both, using the contact details from the CRM. Sending must require a linked patient, an attached prescription copy, and at least one line item.
- **F-NN — Payment route selection.** Staff must choose either Worldpay hosted checkout or pharmacy-managed payment before an order leaves draft. The chosen route must be visible throughout payment review and audit history.
- **F-NN — Pharmacy-managed payment.** For the pharmacy-managed route, authorised staff must manually confirm that the full amount has been received and record the tender type (`EPOS card`, `cash`, `bank transfer`, or `other`). Invoice/receipt reference and reconciliation notes are optional.
- **F-NN — Payment status tracking.** Each sub-order must hold a payment status of Unpaid, Link sent, or Paid, with the amount and a payment reference. Status must be visible in the sub-order, the order summary, the review screen, and the Orders tab.
- **F-NN — Payment confirmation.** Worldpay payments become Paid only following a verified webhook/callback. Pharmacy-managed payments become Paid only following an explicit staff confirmation. Both routes record amount, route and timestamp; manual confirmation also records the staff actor and tender.
- **F-NN — Order-placement gating.** The pharmacy must not be able to request payment or place the stock order with Curaleaf unless the patient is HHH-approved and every sub-order has a named prescriber, attached valid prescription copy, at least one priced item and confirmed patient payment. The place-order action must be disabled and outstanding requirements flagged.
- **F-NN — Resend / expiry.** The pharmacist should be able to resend a payment link, and links should expire after a configurable period.
- **F-NN — Refund/cancellation handling (SHOULD).** If a sub-order is cancelled after payment but before the Curaleaf order is placed, the platform should support flagging the payment for refund.

## Edits to existing requirements

- Order-placement / submission requirement: change "submit when all copies attached" to "place the Curaleaf order only when every sub-order is both copy-attached and paid".
- Sub-order definition: a sub-order now also carries a linked CRM patient and a payment record.
- Orders tab: each sub-order row must show the patient payment (amount, reference) alongside the Curaleaf invoice and shipment tracking.

## Open items to confirm

- Worldpay hosted-checkout API credentials, webhook signing/verification details and final event/status mapping.
- Worldpay's supported method for securely connecting and attributing a separate merchant account to each pharmacy.
- Platform subscription billing frequency, VAT treatment, invoice terms and non-payment handling in the partner agreement.
- Whether the CRM exposes an API/shared DB for patient lookup, or data is co-located on the HHH platform.
- Data protection: storing/handling payment references and linking to special-category prescription data (DPIA/DPA impact).
- Reconciliation: matching patient payments to Curaleaf invoices and to dispensing-fee revenue.
- Part-payment / failed-payment handling and how it affects the place-order gate.
