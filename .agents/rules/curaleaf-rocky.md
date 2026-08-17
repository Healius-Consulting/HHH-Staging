# Curaleaf Rocky API Architecture & Integration Rules

## 1. Core Endpoints & Data Contracts

- **Base URLs**:
  - Sandbox: `https://api.curaleaflaboratories.dev`
  - Production: `https://api.curaleaflaboratories.co.uk`
- **Authentication**: `X-API-Key` header with Secret Manager keys (`CURALEAF_READ_API_KEY_EUROPE_WEST2`, `CURALEAF_WRITE_API_KEY_EUROPE_WEST2`).

### Quotes (`POST /v1/quotes/`)
- **Strict Payload Shape**:
  ```json
  {
    "items": [
      { "packId": "9f2d6958-2d76-4338-9e5f-6fd383dfff36", "quantity": 1 }
    ]
  }
  ```
- **Response Shape**:
  ```json
  {
    "items": [
      {
        "inStock": true,
        "packId": "9f2d6958-2d76-4338-9e5f-6fd383dfff36",
        "quantity": 1,
        "wholesalePackPrice": "68.00",
        "patientPackPrice": "85"
      }
    ],
    "shippingPrice": "5",
    "taxRate": "0.2"
  }
  ```
- **Rule**: Always preserve `patientPackPrice`, `wholesalePackPrice`, and line item unit prices in the order snapshot upon creation so pricing never resets to zero.

### Purchase Orders (`POST /v1/purchase-orders/` & `GET /v1/purchase-orders/`)
- **Strict Creation Shape**:
  ```json
  {
    "customerReference": "ORD-MSWO6GDD",
    "items": [
      { "productId": "9f2d6958-2d76-4338-9e5f-6fd383dfff36", "count": 1 }
    ]
  }
  ```
- **State Machine**:
  - `CREATED`: Cleanroom picking has not started (`packsAllocatedCount = 0`). UI displays `Curaleaf Picked: 0`, `Awaiting Dispatch: orderedCount`.
  - `PROCESSING`: Cleanroom technicians actively picking items (`0 < packsAllocatedCount < packsOrderedCount`).
  - `FULLY_ALLOCATED`: Cleanroom picking complete; all packs boxed and waiting for courier handover (`packsAllocatedCount === packsOrderedCount`).
  - `CANCELLED`: Order cancelled on Curaleaf side.

---

## 2. Strict Payment Gating Rule
- **CRITICAL**: Prescribers, Prescriptions, and Purchase Orders must **NEVER** be created or submitted to Curaleaf before patient payment has cleared (`paymentStatus === 'paid'`).
- If an order is unpaid:
  - Action button is **"Cancel order"** (instantly cancels in platform & retires payment link).
- If an order is paid & placed:
  - Action button is **"Call Curaleaf to cancel"**.

---

## 3. Cancellation & Support Flow
- Clicking **"Call Curaleaf to cancel"** displays a support dialog with Curaleaf's telephone number (`0113 873 0000`), PO Reference, and Prescription Serial with 1-click copy buttons.
- Curaleaf cancels the Purchase Order on their system (`purchaseOrder.state === 'CANCELLED'`).
- The platform detects the `CANCELLED` state and automatically transitions the order into the **Unresolved** list.
- The pharmacy is immediately presented with two resolution paths:
  1. **"Create replacement / Reorder"**: Starts a new draft pre-filling the Patient, Prescriber, and Medication Items & Quantities, with fresh prescription upload required.
  2. **"Cancel & prepare full refund"**: Displays the Worldpay transaction reference for manual processing in Worldpay portal, followed by reference confirmation.

---

## 4. Financial Reporting & Automated Refund Exclusion
- Whenever an order is refunded (`order.paymentStatus === 'refunded'` or `order.refund.status === 'completed'`):
  - Its revenue (`patientRevenuePence`, `productRevenuePence`, `dispensingFeePence`), wholesale cost, and margin are **automatically deducted and excluded** from all recognised gross revenue, profit, and financial summary tiles.
  - The order is tracked in the audit count for **Refunded Prescriptions** and the **Refunded Amount** metric.

---

## 5. Delivery SLA (confirmed with Curaleaf)

| Day placed | Time (London) | Service level |
|---|---|---|
| Mon – Thu | Before 14:30 | **1–2 working days** (excl. weekends) |
| Mon – Thu | 14:30 or after | 2–4 working days |
| Fri (any time) | — | 2–4 working days (Monday batch) |
| Sat / Sun | — | 2–4 working days (Monday batch) |

- Cut-off evaluated in `Europe/London` (BST/GMT aware via `Intl.DateTimeFormat`).
- Friday before 14:30 does **not** qualify for the fast tier — it always joins the Monday batch (DT-4).
- Scenario labels: `DT-1` (1–2 wd), `DT-2` (2–4 wd, next-day processing), `DT-4` (2–4 wd, Monday batch). `DT-3` is retired.
- UI must show a live countdown to 14:30 on Mon–Thu (`DT-1` scenario) and a clear message when Friday/weekend batch applies.

### Delivery Checker (Goods-In) Safeguard
- The pharmacy goods-in form **must only appear** once `purchaseOrderState === 'PROCESSING'` or `'FULLY_ALLOCATED'` (i.e. `packsAllocatedCount ≥ 1`).
- **Never show it** when `purchaseOrderState === 'CREATED'` — Curaleaf has not started picking yet.
- Double-check using `sum(supplierItems[].packsAllocatedCount) > 0` in case state string lags behind the poll.

