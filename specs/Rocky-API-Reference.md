# Curaleaf Laboratories “Rocky” API — Reference

Source: Curaleaf's published OpenAPI 3.1 specification, captured by the `main` branch on 30 June 2026. Confirm details against the current sandbox documentation before production implementation.

## Authentication

- Header: `X-API-Key: <your key>` on every request.
- Rate-limit values remain to be confirmed with Curaleaf.

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

- `GET /v1/products/` includes stock quantity and patient pack price.
- `POST /v1/quotes/` returns live in-stock state, wholesale price, patient price, tax and shipping.
- Re-run the quote immediately before placement and hold the order for staff review if stock or price has changed.

## Delivery and polling

- Rocky provides dispatch/shipment data but not courier-sourced delivery confirmation.
- “Ready for collection” therefore remains a pharmacy staff goods-in action.
- Poll the relevant `*-events/` routes with `after=<ISO datetime>`; Rocky does not provide webhooks for these changes.

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
