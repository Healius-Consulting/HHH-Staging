# Curaleaf Laboratories Customer API

Source of truth: the published OpenAPI 3.1 spec and ReDoc welcome at
[https://api.curaleaflaboratories.co.uk/docs](https://api.curaleaflaboratories.co.uk/docs#section/Welcome-to-the-Curaleaf-Laboratories-Customer-API)
(`https://api.curaleaflaboratories.co.uk/openapi.json`). Re-read that spec before
changing placement, polling, or pharmacy progress UI. Do not invent extra Rocky
fields or a cancel endpoint.

## Base URLs and authentication

- Production: `https://api.curaleaflaboratories.co.uk`
- Sandbox: `https://api.curaleaflaboratories.dev` (ask Curaleaf to activate)
- Every request: `X-API-Key` header. Rate limits apply. HHH stores keys in Secret
  Manager per pharmacy (`hhh-curaleaf-<org>-europe-west2`), spaces calls by at
  least 1.1s, and honours `429` / `Retry-After`.
- There is no partner/master key. Each pharmacy uses its own key. `customerId` in
  responses is Curaleaf’s internal pharmacy id, not GPhC.

## Formulas vs products

A **formula** is what can be prescribed. A **product** is a specific pack/amount
of that formula that can be ordered (for example a 10g pack of a named flower
formula). A formula always has at least one product. Prescriptions and clinical
needs use formula ids and `unitsNeededCount`. Purchase orders that are built
from products use `productId` and pack `count`.

## Official ordering (Welcome)

Curaleaf’s rule: send the **prescriber**, then the **prescription**, to justify
the need. **Purchase orders are only accepted after the prescription has been
accepted.** A purchase order may cover part of one prescription or several
prescriptions. After dispatch, query **shipments**.

### Manual / pharmacy-entered prescription

```
Pharmacy → POST /v1/prescribers/          → Prescriber ID
Pharmacy → GET  /v1/formulas/             → formula IDs
Pharmacy → POST /v1/prescriptions/        (prescriberId, formula items, serial, issueDate)
Pharmacy → POST /v1/prescriptions/{id}/file/  (scan of the script, multipart)
         ← Prescription ID
Pharmacy → GET  /v1/products/             → product IDs
Pharmacy → POST /v1/purchase-orders/      (product IDs + count)   [generic product PO]
         ← Purchase order ID
Pharmacy → GET  /v1/shipments/            (purchaseOrderId)
```

Generic `POST /v1/purchase-orders/` is the product-list route. **HHH paid pharmacy
orders do not use it.** See the HHH placement path below.

### Curaleaf Clinic barcode prescription

Clinic scripts include a barcode Curaleaf can scan. Image rules: must contain a
barcode, must come from Curaleaf Clinic, max 16MB.

```
Pharmacy → POST /v1/prescription-from-image/              → Prescription ID
Pharmacy → POST /v1/purchase-order-from-prescriptions/    (prescriptionIds)
         ← Purchase order ID
Pharmacy → GET  /v1/shipments/
```

---

## HHH paid-order placement (required)

After patient payment has cleared, HHH always follows this three-step Rocky
path. Pharmacy UI must show the same three steps until a purchase order exists,
then switch to the four-step Curaleaf dispensing rail.

1. **Prescriber check** — `GET /v1/prescribers/` and match PIN + GMC/GPhC, or
   `POST /v1/prescribers/` (`name`, `initials`, `pin`, `gmcNumber`, `gphcNumber`).
   Persist the returned `id`. Prescriber `state`: `UNVERIFIED` | `VERIFIED` |
   `ARCHIVED`.
2. **Prescription check** — `POST /v1/prescriptions/` with that `prescriberId`,
   `serialNumber`, `issueDate`, and items `{ formulaId, unitsNeededCount }`.
   Upload the scan with `POST /v1/prescriptions/{prescriptionId}/file/`. Persist
   the returned **prescription id**. Then `GET /v1/prescriptions/{id}/`.
   - `PENDING` — Curaleaf prescription waiter. Do **not** create a purchase
     order. Keep the three-step rail on this step.
   - `ACTIVE` — accepted. Proceed to step 3.
   - `FULFILLED` | `EXPIRED` | `CANCELLED` — do not place a PO.
3. **Purchase order from prescription** — only
   `POST /v1/purchase-order-from-prescriptions/` with
   `{ customerReference, prescriptionIds: [<id from step 2>] }`.
   Never invent product lines for this call. Never use
   `POST /v1/purchase-orders/` for a paid HHH order that already has a
   Curaleaf prescription id.

Clinic scans may skip step 1–2 body entry by using
`POST /v1/prescription-from-image/`, then the **same** step 3 with the returned
prescription id.

If step 3 is skipped because the prescription is `PENDING`, persist
`prescriptionId`, `prescriberId`, `prescriptionState: PENDING` on the order
snapshot and leave fulfilment at supplier-pending. Retry step 3 only when live
Rocky state becomes `ACTIVE`.

### Quotes (stock and price gate)

`POST /v1/quotes/` with `{ items: [{ packId, quantity }] }` returns
`inStock`, `wholesalePackPrice`, `patientPackPrice`, `shippingPrice`, `taxRate`.
Re-check immediately before placement. Preserve quoted patient and wholesale
pack prices on the order snapshot so pricing never resets to zero.

### After the PO exists (dispensing visual)

`PurchaseOrderState`: `CREATED` | `PROCESSING` | `FULLY_ALLOCATED` | `CANCELLED`.

- `CREATED` — picking has not started (`packsAllocatedCount = 0`).
- `PROCESSING` — packs being allocated (`0 < allocated < ordered`).
- `FULLY_ALLOCATED` — all ordered packs allocated.
- `CANCELLED` — Curaleaf cancelled the PO.

Pharmacy Combined progress then replaces the three-step rail:

1. Ordered  
2. Curaleaf Dispensed (allocated / ordered)  
3. In Transit (shipments; Rocky reports dispatch only, not courier delivery)  
4. Checked In (pharmacy goods-in only)

Goods-in must not appear while the PO is `CREATED` or allocated packs are 0.

---

## Payment gating (HHH)

Prescribers, prescriptions, prescription files, and purchase orders must **never**
be created on Rocky before `paymentStatus === 'paid'`. Unpaid orders cancel in
platform and retire the payment link. Paid orders already placed with Curaleaf
use **Call Curaleaf to cancel** (`0113 873 0000`) — there is no cancel API.

---

## Cancellation and support (HHH)

Curaleaf cancels the purchase order on their side (`state === CANCELLED`). HHH
detects that via PO get/events and moves the order to Unresolved. Pharmacy then
either recreates (new draft, fresh prescription upload) or records a Worldpay
refund. Do not call a delete-PO route.

---

## Delivery SLA (confirmed with Curaleaf)

Evaluated in `Europe/London`. Friday before 14:30 is still the Monday batch.

| Day placed | Time (London) | Service level |
|---|---|---|
| Mon – Thu | Before 14:30 | **1–2 working days** (excl. weekends) |
| Mon – Thu | 14:30 or after | 2–4 working days |
| Fri (any time) | — | 2–4 working days (Monday batch) |
| Sat / Sun | — | 2–4 working days (Monday batch) |

Rocky shipments are dispatch authority only. Arrival, check-in, and ready-to-collect
are pharmacy dispensary records.

---

## Polling

Rocky has no webhooks for these resources. Poll `*-events/` with `after=<ISO>`.
HHH uses 60s per connected pharmacy with per-route cursors: product, prescription,
purchase-order, shipment. Deduplicate overlapping windows.

## Key list/get routes

| Resource | List / get | States |
|---|---|---|
| Prescribers | `GET /v1/prescribers/`, `GET /v1/prescribers/{id}/` | `UNVERIFIED`, `VERIFIED`, `ARCHIVED` |
| Prescriptions | `GET /v1/prescriptions/`, `GET /v1/prescriptions/{id}/`, `GET /v1/prescriptions/{serial}/` | `PENDING`, `ACTIVE`, `FULFILLED`, `EXPIRED`, `CANCELLED` |
| Purchase orders | `GET /v1/purchase-orders/`, `GET /v1/purchase-orders/{id}/` | `CREATED`, `PROCESSING`, `FULLY_ALLOCATED`, `CANCELLED` |
| Shipments | `GET /v1/shipments/`, `GET /v1/shipments/{id}/` | dispatch records; filter with `purchaseOrderId` |
| Formulas / products | `GET /v1/formulas/`, `GET /v1/products/` | formula `ACTIVE`/`DISCONTINUED`/`ARCHIVED`; product `ACTIVE`/`DISCONTINUED` |

List query params: `pageNumber`, `pageSize`, `sortColumn`, `sortDirection`,
`searchQuery`, `stateFilter`.
