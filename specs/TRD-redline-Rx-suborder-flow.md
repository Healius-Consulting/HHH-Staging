# TRD v1.4 → proposed redline: prescription-gated sub-order ordering

Ready-to-insert requirement text for the new ordering model. F-IDs shown as placeholders (F-NN) — final numbers to be assigned on merge into the live document, with consecutive renumbering across the affected section.

## Concept change (update the ordering/basket narrative)

Replace the single-basket model with a **prescription sub-order** model: an **order** is a container for one or more **prescription sub-orders**. Each sub-order represents one patient prescription and consists of (a) a mandatory uploaded copy of that prescription and (b) the line items prescribed on it. Rationale: suppliers must review the prescription copy before approving a sub-order for delivery, so every product must be assigned to a prescription.

## New / revised functional requirements

- **F-NN — Order structure.** An order shall comprise one or more prescription sub-orders. Each sub-order shall hold exactly one prescription and one or more line items.
- **F-NN — Prescription copy upload (mandatory).** Each sub-order shall require an uploaded copy of the prescription. Accepted formats: PDF, JPG, PNG; max size [TBD — suggest 10 MB]. The copy shall be stored against the sub-order and transmitted to the supplier.
- **F-NN — Sub-order metadata.** Each sub-order shall capture patient identifier and prescriber against the uploaded prescription.
- **F-NN — Assign product from catalogue.** From the catalogue, selecting "Add to Rx" shall prompt the user to assign the product to an existing sub-order or to start a new sub-order (which requires a prescription upload).
- **F-NN — In-flow product search.** Within the Create Rx order flow, the user shall be able to search the catalogue and add prescribed items directly to the active sub-order. (Both entry points are supported.)
- **F-NN — Add further sub-orders.** The user shall be able to add additional prescription sub-orders to the same order.
- **F-NN — Submit gating (hard block).** The order shall not be submittable until every sub-order has a prescription copy attached. Submit shall be disabled and the missing sub-orders flagged.
- **F-NN — Consolidated review.** Before submission the user shall be shown a review summarising all sub-orders (prescription copy status, prescriber, line items, sub-order totals) and the order total.
- **F-NN — Per-sub-order supplier approval.** Each sub-order shall be routed to the relevant supplier for review of the attached prescription and approved for delivery independently.
- **F-NN — Per-sub-order status tracking (Orders tab).** The Orders tab shall track status at sub-order level (e.g. Awaiting approval / Approved / Dispatched), since sub-orders are approved and dispatched independently.

## Knock-on items to confirm

- Accepted file formats and max upload size for prescription copies.
- Whether a single sub-order can span multiple suppliers (affects whether approval is per-sub-order or per-supplier-within-sub-order).
- Retention/handling rules for stored prescription images (data protection / clinical record-keeping).
- Existing 2pm delivery cut-off: does it apply per sub-order or to the consolidated order?
