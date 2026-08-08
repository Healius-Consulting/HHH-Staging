# Curaleaf Laboratories “Rocky” API — Reference

Source: Curaleaf's published OpenAPI 3.1 specification, captured by the `main` branch on 30 June 2026. Confirm details against the current sandbox documentation before production implementation.

## Authentication

- Header: `X-API-Key: <your key>` on every request.
- Curaleaf confirmed a soft limit of one request per second per pharmacy key, a substantially higher hard limit, and `429` responses with rate-limit headers. HHH spaces requests by at least 1.1 seconds and honours `Retry-After`.
- There is no master/partner key. Every pharmacy uses its own server-side key; a separate read-only key is optional.

## Core concepts

- A **formula** is something that can be prescribed.
- A **product** is a specific orderable pack/amount of a formula.
- Prescriptions express need in formulas; purchase orders use products.

## Ordering flows

Manual prescription:

1. `POST /v1/prescribers/`
2. `GET /v1/formulas/`
3. `POST /v1/prescriptions/`
4. `POST /v1/prescriptions/{id}/file/` (multipart prescription scan)
5. `GET /v1/products/`
6. `POST /v1/purchase-orders/`
7. `GET /v1/shipments/?purchaseOrderId=…`

Curaleaf Clinic barcode prescription:

1. `POST /v1/prescription-from-image/`
2. `POST /v1/purchase-order-from-prescriptions/`
3. `GET /v1/shipments/?purchaseOrderId=…`

For the HHH prescription-gated sub-order model, submit one purchase order per prescription so approval and tracking remain independent.

## Stock and price gate

- `GET /v1/products/` includes stock quantity and Curaleaf’s recommended patient pack price.
- `POST /v1/quotes/` returns live in-stock state, wholesale price, patient price, tax and shipping.
- Re-run the quote immediately before placement. Out-of-stock items remain blocked; supplier-cost-only changes require audited approval; patient-price changes require cancellation/refund and order recreation.

## Delivery and polling

- Rocky provides dispatch/shipment data but not courier-sourced delivery confirmation.
- “Ready for collection” therefore remains a pharmacy staff goods-in action.
- Poll the relevant `*-events/` routes with `after=<ISO datetime>`; Rocky does not provide webhooks for these changes.
- Curaleaf recommends a ten-second interval. HHH polls every **60 seconds** per connected pharmacy (gentler on the ~1 req/s soft limit). Poll product, prescription, purchase-order and shipment events with per-route cursors and overlapping deduplication windows.

## Confirmed operational constraints — 5 August 2026 (Phil Jones)

- `customerId` is Curaleaf’s **internal** stable pharmacy ID. Retain GPhC premises number separately for HHH tenancy; do not treat `customerId` as a GPhC mapping.
- Catalogues **can** be customer-specific; Phil does not believe this applies to HHH today. Ellis to confirm operating model. Prefer per-pharmacy keys and quote-time pricing.
- **No partner/master API key** yet. Every pharmacy uses its own server-side key (optional separate read-only key). Curaleaf may revisit partner keys later.
- Prescription uploads are limited to **16MB**. HHH accepts server-verified PDF, JPEG and PNG (`MAX_PRESCRIPTION_FILE_BYTES = 16_000_000`).
- Soft rate limit ≈ **1 request/second** per key (higher hard limit). `429` responses include rate-limit headers. Curaleaf-recommended event polling interval: **10 seconds**; HHH uses **60 seconds**. HHH spaces outbound Curaleaf calls by ≥1s and honours `Retry-After`.
- A **prescriber is required** for every prescription (including manual). Search or `POST /v1/prescribers/` first; Curaleaf validates credentials before shipping.
- Wholesale / live stock for a specific order: use **`POST /v1/quotes/`** (pack IDs + quantities). Catalogue exposes recommended patient pack price and quantity; quotes are pack-based with no prescription linkage.
- Declined prescription review and **purchase-order cancellation** are **customer-service processes** today (no formal CANCELLED reason payload / no cancel API). HHH opens an internal support case and does not call `DELETE /v1/purchase-orders/:id`.
- After initial integration acceptance and Ellis approval, later pharmacies may go direct-to-live without sandbox. Keep disabled until written approval.
- **Still open externally:** stocked sandbox products (Q4), existing + second sandbox pharmacy keys (Q5), Ellis catalogue confirmation (Q2), written direct-to-live approval (Q6), DPA / scan retention (Q13).

## Important corrections to earlier assumptions

- Authentication is `X-API-Key`, not an API-key plus username pair.
- Endpoints are versioned under `/v1/`.
- A prescriber is created before a manual prescription.
- The prescription scan is a separate multipart upload.
- Product quantity and quote `inStock` support a placement-time stock check.
- Courier values include `DX`, `POLAR_SPEED`, `CURALEAF`, `TRANSFER`, and `OTHER`; do not hard-code DPD as a Rocky value.
- Rocky has no dedicated invoice endpoint; reconcile the purchase-order `customerReference` with shipment charges and quote data.

## Known list parameters

`pageNumber`, `pageSize`, `sortColumn`, `sortDirection`, `searchQuery`, `stateFilter`.
