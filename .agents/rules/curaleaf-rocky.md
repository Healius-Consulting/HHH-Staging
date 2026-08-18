# Curaleaf Laboratories Customer API — HHH notes

Source of truth: OpenAPI 3.1 at
[https://api.curaleaflaboratories.co.uk/docs](https://api.curaleaflaboratories.co.uk/docs#section/Welcome-to-the-Curaleaf-Laboratories-Customer-API)
(`https://api.curaleaflaboratories.co.uk/openapi.json`, spec `1.0`). Re-read that
spec before changing placement, polling, or pharmacy progress UI. Do not invent
Rocky fields or a cancel endpoint.

Live HHH caller is `services/api-sql` (`apiLondon`). Do not treat `services/api`
as the live order backend.

## Base URLs and authentication

- Production: `https://api.curaleaflaboratories.co.uk`
- Sandbox: `https://api.curaleaflaboratories.dev` (ask Curaleaf to activate)
- Every request: `X-API-Key`. HHH stores keys in Secret Manager per pharmacy
  (`hhh-curaleaf-<org>-europe-west2`). GET uses the read key when present;
  writes use the write key. Space calls ≥1.1s and honour `429` / `Retry-After`.
- No partner/master key. `customerId` in responses is Curaleaf’s internal
  pharmacy id, not GPhC. Reject payloads whose `customerId` is not this pharmacy.

## Formulas vs products

A **formula** is what can be prescribed. A **product** is a pack of that formula
(for example 10g). Prescriptions use `{ formulaId, unitsNeededCount }`. Generic
product POs use `{ productId, count }`. HHH paid orders never send product lines
on PO create — Rocky builds those from the accepted prescription.

---

## What HHH uses, and why

Paid pharmacy orders always follow Curaleaf’s rule: **prescriber, then
prescription (accepted), then purchase order**. After payment, `executeCuraleafOrderPlacement`
runs this path once per HHH order (`customerReference` = HHH order number). One
PO per prescription so tracking stays 1:1.

### Placement (write)

| Call | Why we use it |
|---|---|
| `GET /v1/prescribers/` | Match PIN + GPhC or GMC already on Rocky. Avoids duplicate prescribers. |
| `POST /v1/prescribers/` | Create only when no match. Body: `name`, `initials`, `pin`, `gmcNumber`, `gphcNumber`. Required before a manual prescription. |
| `POST /v1/quotes/` | Live stock/price check immediately before submit. Body: `{ items: [{ packId, quantity }] }`. Keep quoted patient/wholesale prices on the HHH snapshot. **Live placement currently re-quotes and logs only** — it does not hold. Intended review is below. |
| `POST /v1/prescriptions/` | Manual script: `serialNumber`, `prescriberId`, `issueDate`, `items[{ formulaId, unitsNeededCount }]`. This is how pharmacy-entered scripts enter Rocky. Persist the returned **prescription id**. |
| `POST /v1/prescriptions/{id}/file/` | Multipart scan (PDF/JPEG/PNG, 16MB). Separate from create. Upload even if SQL marked the local file deleted, if the GCS object still exists. Do **not** purge the local copy until the PO from that prescription exists. |
| `GET /v1/prescriptions/{id}/` | Waiter. `PENDING` = do not create a PO; stamp `prescriptionState` and leave fulfilment `SUPPLIER_PENDING`. `ACTIVE` = proceed. `EXPIRED` / `CANCELLED` = stop. |
| `POST /v1/purchase-order-from-prescriptions/` | **The only PO-create HHH uses for paid orders.** Body: `{ customerReference, prescriptionIds: [<id from POST /prescriptions/>] }`. Rocky chooses products from the accepted script. Never invent `{ productId, count }` here. |

Clinic barcode scripts may skip prescriber/prescription body entry with
`POST /v1/prescription-from-image/` (portal scan helper), then the **same**
`POST /v1/purchase-order-from-prescriptions/` with that prescription id.

### Catalogue (read)

| Call | Why we use it |
|---|---|
| `GET /v1/formulas/` | Pharmacy catalogue / quote bank. Paginated. |
| `GET /v1/products/` | Pack ids, stock quantity, recommended patient pack price. Paginated. |
| `POST /v1/quotes/` | Same as placement requote; also the portal quote button at order create. |

### Quote review (intended; not live on api-sql yet)

Create-order already quotes. Placement requotes the same packs and compares
`inStock`, `patientPackPrice`, `wholesalePackPrice` with the snapshot. Out of
stock holds placement (no absorb). Price moves hold as `quote_review_required`
until the pharmacy picks one audited action:

**Patient pack price went up**

- Absorb — patient stays on the paid total; pharmacy eats the increase.
- Payment link for the difference — place only after that top-up is `PAID`.

**Patient pack price went down**

- Refund the difference to the patient, then place (or cancel if they refund in full and stop).
- Continue — keep the paid total. Record the drop as extra **dispensing fee** (pharmacy choice, not a silent overcharge).

**Wholesale changed, patient price unchanged** — pharmacy margin only. Absorb or hold; no patient payment link.

Do not auto-place while review is required. After absorb, continue-as-fee, or a
cleared top-up, run `POST /v1/purchase-order-from-prescriptions/` as normal.

### After a PO exists (read)

Rocky has no webhooks. HHH polls every **60s** per connected pharmacy (Curaleaf
suggested 10s; 60s is gentler on the ~1 req/s soft limit).

| Call | Why we use it |
|---|---|
| `GET /v1/purchase-orders/` | Match this order’s PO by `customerReference` / stored id. States below. |
| `GET /v1/shipments/` | Dispatch only (in-transit). Filter mentally by `purchaseOrderId`. No courier “delivered”. |
| `GET /v1/purchase-order-events/?after=` | Catch `CREATED` → `PROCESSING` → `FULLY_ALLOCATED` or `CANCELLED` without listing everything. Then GET the PO. |
| `GET /v1/shipment-events/?after=` | New consignments (including split ships). Then GET the shipment. |
| `GET /v1/prescription-events/?after=` | `PENDING` → `ACTIVE` so a waiting order can retry PO-from-prescriptions. |
| `GET /v1/product-events/?after=` | Catalogue/stock changes into the quote bank. |

Event payloads are `{ <entity>Id, customerId, lastUpdated }`. Deduplicate with
overlapping cursors. Portal “activity” also lists `GET /v1/prescribers/`,
`GET /v1/prescriptions/`, `GET /v1/purchase-orders/`, `GET /v1/shipments/`.

### PO states we observe (Curaleaf sets these; HHH does not)

`PurchaseOrderState`: `CREATED` | `PROCESSING` | `FULLY_ALLOCATED` | `CANCELLED`.

- `CREATED` — picking not started (`packsAllocatedCount = 0`).
- `PROCESSING` — partial pick (`0 < allocated < ordered`).
- `FULLY_ALLOCATED` — all ordered packs allocated.
- `CANCELLED` — Curaleaf cancelled (phone CS; no cancel API).

Pharmacy Combined progress after a real PO id exists:

1. Ordered  
2. Curaleaf Dispensed (allocated / ordered)  
3. In Transit (shipments)  
4. Checked In (pharmacy goods-in only)

Hide goods-in while the PO is `CREATED` or allocated packs are 0. Until a PO id
exists, show the 3-step rail: Prescriber check → Prescription check → Purchase
order sent.

---

## Official Welcome vs HHH

Curaleaf documents two create-PO routes. HHH paid orders use only the second.

**Welcome flow A (product list) — do not use for paid HHH orders**

```
POST /v1/prescribers/
GET  /v1/formulas/
POST /v1/prescriptions/
POST /v1/prescriptions/{id}/file/
GET  /v1/products/
POST /v1/purchase-orders/          ← { customerReference, items[{ productId, count }] }
GET  /v1/shipments/
```

`POST /v1/purchase-orders/` is valid Rocky. HHH does not call it after a
prescription id exists, because the PO would be detached from that script and
Curaleaf cannot tell we sent the clinical justification.

**Welcome flow B (from prescriptions) — this is HHH paid placement**

```
POST /v1/prescription-from-image/     ← clinic barcode only; HHH manual scripts use POST /prescriptions/ instead
POST /v1/purchase-order-from-prescriptions/
GET  /v1/shipments/
```

HHH manual path is flow A’s prescriber + prescription + file, then flow B’s
`purchase-order-from-prescriptions` (not flow A’s product PO).

---

## Published routes we do not use

These exist on OpenAPI 1.0. Do not add them unless there is a new product reason.

| Route | Why unused |
|---|---|
| `POST /v1/purchase-orders/` | Product-list PO. Paid HHH orders use from-prescriptions instead. |
| `GET /v1/formulas/{id}/`, `GET /v1/products/{id}/` | List pages are enough for catalogue. |
| `GET /v1/prescribers/{id}/` | Placement matches from the list. |
| `GET /v1/prescriptions/` list, `GET /v1/prescriptions/{serial}/`, `GET /v1/prescriptions/{id}/file/` | Placement uses GET-by-id for state only; file is POST-only for us. |
| `GET /v1/purchase-orders/{id}/`, `GET /v1/shipments/{id}/` | Lists + event-then-detail cover live orders. Event poller may GET detail by id. |
| `GET /v1/formula-events/`, `GET /v1/prescriber-events/` | Catalogue uses product events; prescribers are matched at placement. |
| All `/v1/clinical-needs/` (GET/POST/PUT, file, signed, events) | Specials / clinical-need workflow. HHH pharmacy orders are formula prescriptions + from-prescriptions POs. |

There is **no** `DELETE` / cancel PO, **no** invoice route, **no** courier
delivered timestamp. Financials are quote + shipment `shipmentCharge` /
`packPrice`. Couriers on a PO: `DX`, `POLAR_SPEED`, `CURALEAF`, `TRANSFER`,
`OTHER` (not DPD).

## Leftover code — do not treat as Rocky

- `DELETE /v1/purchase-orders/{id}` in cancel-and-archive is **not in the spec**.
  Cancellation is Curaleaf CS (`0113 873 0000`). Detect `CANCELLED` from GET/events.
- `POST /v1/clinic-prescriptions/` on the portal barcode helper is **not in the
  spec**. Clinic scans use `POST /v1/prescription-from-image/`.

---

## Payment gating (HHH)

Prescribers, prescriptions, files, and POs must never be created on Rocky before
`paymentStatus === 'PAID'`. Manual payment must pass the already-paid order into
placement (the pre-update row is still unpaid). Unpaid orders cancel in HHH and
retire the payment link.

## Cancellation (HHH)

Curaleaf sets `state === CANCELLED`. HHH moves the order to Unresolved. Pharmacy
recreates (new draft, fresh scan) or records a Worldpay refund. Do not call a
delete-PO route.

## Delivery SLA (confirmed with Curaleaf)

`Europe/London`. Friday before 14:30 is still the Monday batch.

| Day placed | Time (London) | Service level |
|---|---|---|
| Mon – Thu | Before 14:30 | **1–2 working days** (excl. weekends) |
| Mon – Thu | 14:30 or after | 2–4 working days |
| Fri (any time) | — | 2–4 working days (Monday batch) |
| Sat / Sun | — | 2–4 working days (Monday batch) |

Shipments are dispatch authority only. Arrival, check-in, and ready-to-collect
are pharmacy dispensary records.

List query params: `pageNumber`, `pageSize`, `sortColumn`, `sortDirection`,
`searchQuery`, `stateFilter`.
