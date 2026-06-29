# TRD addition: patient payment & HHH CRM integration

Proposed requirements for the patient-payment feature. Intended for merge into the TRD as v1.6, with consecutive F-ID renumbering on merge. Suggested new section **6.9 Patient Payment** plus edits to the sub-order and order-placement requirements.

## Concept

The pharmacy must collect payment from the patient before stock is ordered from Curaleaf, to reduce the risk of unused (and unpaid-for) controlled medication. Patient records already exist in the HHH CRM (patient completes an online eligibility assessment → pharmacist adds SCR and marks the patient as referred → name, address, email and mobile are held). The ordering system reads from this CRM so the journey is frictionless for staff and patient. Payment is per prescription sub-order, because each sub-order belongs to a single patient.

End-to-end flow: prescription presented → staff search the live formulary, check stock/price, add items to a sub-order → staff link the patient from the CRM and send a payment link → patient pays → the pharmacy places the stock order with Curaleaf.

## New functional requirements (section 6.9 Patient Payment)

- **F-NN — CRM patient lookup.** When building a sub-order, the pharmacist must be able to search the HHH CRM and link a referred patient. On linking, the patient's name, email, mobile, and address must populate the sub-order without manual re-entry.
- **F-NN — One patient per sub-order.** Each prescription sub-order must be associated with exactly one CRM patient record.
- **F-NN — Patient charge calculation.** The amount payable by the patient for a sub-order must be the sum of the patient price of each line item plus any applied dispensing fee.
- **F-NN — Send payment link.** The pharmacist must be able to send the patient a secure payment link for the sub-order via email, SMS, or both, using the contact details from the CRM. Sending must require a linked patient, an attached prescription copy, and at least one line item.
- **F-NN — Payment status tracking.** Each sub-order must hold a payment status of Unpaid, Link sent, or Paid, with the amount and a payment reference. Status must be visible in the sub-order, the order summary, the review screen, and the Orders tab.
- **F-NN — Payment confirmation.** The platform must update a sub-order to Paid when the payment provider confirms payment (webhook/callback), recording amount, reference, and timestamp.
- **F-NN — Order-placement gating (payment).** The pharmacy must not be able to place the stock order with Curaleaf until every sub-order in the order has both an attached prescription copy and a confirmed patient payment. The place-order action must be disabled and outstanding sub-orders flagged.
- **F-NN — Resend / expiry.** The pharmacist should be able to resend a payment link, and links should expire after a configurable period.
- **F-NN — Refund/cancellation handling (SHOULD).** If a sub-order is cancelled after payment but before the Curaleaf order is placed, the platform should support flagging the payment for refund.

## Edits to existing requirements

- Order-placement / submission requirement: change "submit when all copies attached" to "place the Curaleaf order only when every sub-order is both copy-attached and paid".
- Sub-order definition: a sub-order now also carries a linked CRM patient and a payment record.
- Orders tab: each sub-order row must show the patient payment (amount, reference) alongside the Curaleaf invoice and shipment tracking.

## Open items to confirm

- Payment provider (e.g. Stripe/Worldpay) and integration method (hosted link, webhook events).
- Whether the CRM exposes an API/shared DB for patient lookup, or data is co-located on the HHH platform.
- Data protection: storing/handling payment references and linking to special-category prescription data (DPIA/DPA impact).
- Reconciliation: matching patient payments to Curaleaf invoices and to dispensing-fee revenue.
- Part-payment / failed-payment handling and how it affects the place-order gate.
