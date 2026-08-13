# Master pharmacy order flow — implemented decisions

**Effective baseline:** 12 August 2026. Dated detailed specifications continue to override older summaries.

## Invariants

- A paid patient is never charged more and never receives less without a recorded refund for the difference.
- Curaleaf stock ordering requires confirmed patient payment.
- Out-of-stock quotes block payment and placement, per the 5 August Rocky reference.
- Ready for collection is created only from a complete pharmacy goods-in receipt.
- Expired prescriptions hard-block payment, placement, goods-in and handout.
- Patient-message kinds are restricted to payment request/reminders, payment confirmation, ready for collection and the 48-hour delay exception.

## Flow

1. **Build:** server-owned draft, one or more stable prescription sub-orders, valid copy/date/prescriber/patient match, active packs and an in-stock quote. The optional order fee is £0 or £5–£15. The 25% line margin is advisory.
2. **Payment:** one patient-order payment. Worldpay links expire after the earlier of 72 hours or the earliest payable prescription. Reminder attempts occur at 24 and 48 hours. Resend creates a new generation. Unpaid expired prescriptions are removed from the payable amount and the link is replaced; late settlement of a superseded link requires refund.
3. **Placement:** exact per-prescription requote and one PO per prescription. Supplier-cost increases proceed only when fixed patient revenue plus allocated order fee retains a 15% line margin; otherwise the line is held. Patient-price changes require refund/recreation.
4. **Fulfilment:** Curaleaf events poll every 60 seconds with overlap, deduplication and backoff. Counts are tracked per line across split shipments. Under-shipped lines produce one delay notification per continuous episode. Unfulfilled lines enter renewal hold seven days before expiry and create staff tasks; expiry escalates but never auto-refunds.
5. **Goods-in:** every received medicine requires batch number and batch expiry. Partial receipts are retained. Each complete shipment may create one ready notification.
6. **Collection:** handout is per shipment and rolls up to prescription then order. The first-ever collected dispense creates the prospective £50 event; every dispense re-anchors follow-up by one month for the first order and three months thereafter.

## Go-live gate

The Admin Pharmacies card exposes exactly two authoritative gates:

1. The owning company has confirmed signed GDPR/data-sharing evidence using a Google Drive or Google Docs URL.
2. The branch LIVE Curaleaf key has passed a read test and is stored in Secret Manager.

The admin-only **Go live** action rechecks both gates server-side. TEST validation and the six operational tasks remain UAT evidence only. Removing company GDPR evidence pauses all owned live branches; the scheduled gate audit also pauses live branches missing either record.

## Provider extensions

Patient delivery uses an idempotent outbox and the configured `PATIENT_MESSAGE_PROVIDER_URL`. Provisional Curaleaf operations use URL templates rather than assumed hard-coded routes:

- `CURALEAF_HOLD_URL_TEMPLATE`
- `CURALEAF_RENEWAL_ATTACH_URL_TEMPLATE`
- `CURALEAF_LINE_EXCLUSION_URL_TEMPLATE`

Templates may contain `{purchaseOrderId}`, `{prescriptionId}`, `{renewedPrescriptionId}`, `{lineId}` and `{packId}`. Missing configuration retains the clinical/financial hold and creates or preserves a staff task.

## Rollout

Run the authenticated admin migration `POST /v1/portal/admin/migrations/master-flow-v2` once, then `POST /v1/portal/admin/go-live/audit`. Both are idempotent and audited. Historical payment snapshots and £50 ledger entries are preserved.
