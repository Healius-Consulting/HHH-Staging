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
- Curaleaf recommends a ten-second interval. Poll product, prescription, purchase-order and shipment events with per-route cursors and overlapping deduplication windows.

## Confirmed operational constraints — 5 August 2026

- `customerId` is Curaleaf’s internal stable identifier for a pharmacy; it is not treated as a GPhC mapping.
- Prescription uploads are limited to 16,000,000 bytes. HHH accepts server-verified PDF, JPEG and PNG files.
- A prescriber is required for every prescription. HHH searches or creates the prescriber before prescription creation; Curaleaf validates credentials before shipping.
- Prescription review exceptions and purchase-order cancellation requests are handled through Curaleaf customer service; there is no formal cancellation API.
- After initial integration acceptance and Ellis approval, later pharmacies may be allowed to go directly live. This remains disabled until written approval.
- Stocked dev products, two dev-pharmacy keys, catalogue applicability for HHH, and the DPA/scan-retention terms remain open external dependencies.

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
