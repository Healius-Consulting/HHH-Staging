# SQL Connect backend rewrite plan

Status: approved architecture baseline; implementation and data migration remain staged work.

## Decision

HHH will move operational data from Firestore to Firebase SQL Connect backed by Cloud SQL for PostgreSQL in London (`europe-west2`). Firebase Authentication, App Check, private Cloud Storage, Secret Manager, and the existing authenticated Express API remain part of the platform.

This is a relational redesign, not a document-for-table copy. The SQL schema normalises organisations, staff, referrals, patients, prescriptions, orders, payments, placements, shipments, receipts, integrations, notifications, fees, and audit events. JSON is retained only where the shape is intentionally external or temporary: draft payloads, immutable supplier/provider snapshots, audit details, and task metadata.

The checked-in SQL Connect source is `dataconnect/schema/schema.gql`. The service is configured by `dataconnect/dataconnect.yaml` with `COMPATIBLE` migration mode so future deployments do not drop unknown database objects during the staged transition.

## Non-negotiable security boundary

1. The browser never connects directly to Cloud SQL.
2. The initial schema has no connector, so client operations are fail-closed (`NO_ACCESS`).
3. The first implementation continues to use the existing Express API and Firebase Admin SQL Connect SDK. Existing App Check, verified-email, TOTP MFA, session revocation, idle/absolute expiry, CSRF, allowed-origin, role, and tenant checks remain mandatory.
4. Pharmacy identity is derived from the verified Firebase token/session. A pharmacy ID supplied in a request is never authoritative.
5. Every tenant-owned row carries an indexed organisation foreign key. Every repository method must scope its initial lookup and every joined lookup by that organisation. Cross-tenant misses return `404`, not `403`, to avoid record enumeration.
6. HHH administration and pharmacy operations use separate reviewed GraphQL operations. No generic table CRUD, arbitrary filter, bulk mutation, or delete operation is exposed.
7. Any future client connector must use explicit `@auth`, `@check`, `@redact`, `@allow`, and `@transaction` rules. `USER` alone is not sufficient. No `PUBLIC` operation may read clinical, identity, financial, staff, audit, integration, or operational data.
8. Secrets remain in Secret Manager. SQL stores only the secret resource name, masked credential, validation state, and non-secret external customer ID.
9. Prescription binaries remain in private Cloud Storage. SQL stores metadata and the private storage path only. Signed URLs remain short-lived and server-issued after tenant and purpose checks.
10. Money is stored as integer pence (`Int64`), timestamps as UTC `Timestamp`, prescription/DOB values as `Date`, and externally replayable requests use unique idempotency keys.
11. Organisations, staff, patients, orders, payments, prescriptions, and audit history use state transitions and soft deletion. Connectors expose no hard-delete mutations for retained records.
12. Audit, assignment, placement, webhook, dispense, fee, and notification events are append-only through the application. Corrections are new events, not silent rewrites.

## Relational domains

| Domain | SQL tables | Key redesign |
| --- | --- | --- |
| Tenancy and access | `Company`, `Organisation`, `OrganisationDomain`, `StaffUser`, `StaffSession` | One canonical tenant key; Auth UID remains the staff key; sessions contain hashes only. |
| Governance | `AuditLog`, `SetupTask`, `StaffTask` | Security and workflow history becomes queryable, append-oriented records. |
| Intake | `ReferralToken`, `EligibilitySubmission`, `EligibilityConsent`, `EligibilityCondition`, `EligibilityAssignmentEvent` | Allocation state lives on one case; legacy overlay documents disappear; consent and assignment history are explicit. |
| Patients | `Patient`, `PatientIdentity`, `PatientCondition` | Canonical patient row per pharmacy; hashed identity constraint prevents duplicate referral activation without storing a second plaintext email. |
| Prescriptions | `Prescriber`, `PrescriptionFile`, `Prescription`, `PrescriptionLine` | File metadata, prescription facts, and medicine lines are separate; supplier snapshots remain immutable. |
| Orders | `OrderDraft`, `Order`, `OrderPrescription`, `OrderLine`, `PlacementEvent` | Drafts are mutable only before the payment boundary; prescriptions and items become relational; placement transitions are auditable. |
| Payments | `Payment`, `PaymentReceipt`, `Refund` | Provider references and idempotency are unique; payment lifecycle is not embedded inside an order document. |
| Supplier fulfilment | `IntegrationConnection`, `IntegrationOperation`, `IntegrationWebhookEvent`, `Shipment`, `ShipmentLine`, `GoodsReceipt`, `GoodsReceiptLine` | API calls, supplier state, dispatch, pharmacy goods-in, and patient collection remain distinct. |
| Finance and messaging | `DispenseEvent`, `ReferralFeeEvent`, `NotificationOutbox` | Fee triggers and notifications use durable, idempotent events. |
| Public directory | `PharmacyDirectoryProfile` | Public data remains separated from private tenant configuration and clinical data. |

## Rewrite sequence

### Phase 0 — evidence and rollback

- Confirm that no real patient data exists before using the new database for development.
- Export Firestore and Auth metadata to an access-controlled UK-region backup location.
- Record collection counts, required-field null counts, duplicate business keys, orphan references, and representative workflow snapshots.
- Freeze schema changes during each cutover window. Do not delete Firestore collections.

Exit gate: repeatable backup and inventory report; named rollback owner; no unresolved data-classification question.

### Phase 1 — SQL foundation

- Keep the checked-in schema and Firebase configuration as the source of truth.
- Add emulator/CI schema compilation and SQL migration diff checks.
- Create separate development/staging and production Firebase projects before live data; do not mix environments inside one database.
- Restrict Cloud SQL networking and IAM to SQL Connect/Firebase service identities and a small break-glass admin group. Disable broad developer database access.
- Add budget alerts, database backups, point-in-time recovery, maintenance windows, query insights with privacy-safe logging, and connection limits before live traffic.

Exit gate: schema compiles; migration diff is reviewed; backups restore successfully; IAM review passes.

### Phase 2 — secure repository layer

- Introduce a SQL repository beside the Firestore repository. Keep route/business logic independent of storage.
- Use the Firebase Admin SQL Connect SDK from the authenticated API. Do not give the web apps a generic client connector during the first cutover.
- Implement small named operations per use case, not reusable generic CRUD. Mutations spanning multiple tables use `@transaction` or one server transaction.
- Re-check active staff status and tenant ownership inside each sensitive operation. Preserve current role and tenant middleware as a first security layer.
- Require optimistic versions for allocation, onboarding, payment, order, and fulfilment state changes.
- Add database/application checks for non-negative money and quantities, prescription expiry windows, immutable paid amounts, legal state transitions, idempotency, and tenant-consistent joins.

Exit gate: negative authorization tests prove that a pharmacy user cannot enumerate, read, mutate, join, or infer another pharmacy's rows; admin-only operations reject pharmacy roles.

### Phase 3 — migrate by bounded context

Migrate in dependency order:

1. companies, organisations, setup state, staff profiles, and active sessions;
2. directory profiles and referral tokens;
3. eligibility submissions, consent, conditions, and assignment history;
4. patients, identity keys, prescription files, prescriptions, and prescribers;
5. drafts, orders, order lines, placement history, and payments;
6. integrations, shipments, receipts, dispense/fee events, notifications, tasks, and audit logs.

Each importer must be idempotent, restartable, dry-run capable, and write a migration ledger containing the source collection/document ID, target table/row ID, transform version, source hash, outcome, and timestamp. Invalid or ambiguous documents go to a quarantine report; they are never silently coerced.

Exit gate per domain: row counts reconcile, foreign keys have no orphans, unique keys have no unexplained collisions, sampled values match, and workflow totals/status distributions match.

### Phase 4 — shadow and cutover

- Backfill SQL, then mirror new writes only through an outbox-driven migration adapter; avoid uncoordinated best-effort dual writes.
- Shadow critical Firestore reads against SQL and compare privacy-safe hashes/counts, totals, statuses, and ownership—not raw PII in logs.
- Cut over one domain behind a server-side feature flag after parity is sustained.
- During final cutover: pause writes briefly, drain the outbox, import the delta, verify, switch reads/writes, and retain Firestore as read-only rollback evidence.
- Roll back by switching the domain flag before any post-cutover write is allowed to diverge without a reverse-replay path.

Exit gate: UAT, security regression, load tests, backup restore, operational monitoring, reconciliation, and rollback rehearsal all pass.

### Phase 5 — retirement

- Remove Firestore reads only after the agreed rollback and statutory retention windows.
- Revoke obsolete Firestore IAM/service access, indexes, scheduled workers, and code paths.
- Preserve required audit and migration evidence under an approved retention schedule; securely destroy redundant copies.

## Required automated security tests

- unauthenticated, unverified-email, missing App Check, missing TOTP, expired, idle-expired, and revoked sessions fail closed;
- pharmacy role cannot call HHH admin operations;
- tenant A cannot access tenant B by ID, filter, relation traversal, batch input, sort/search, or timing/error differences;
- disabled/removed staff lose access even if an old token still contains claims;
- client-supplied organisation IDs cannot override the verified claim;
- prescription file paths and signed URLs cannot cross tenants or outlive the configured TTL;
- provider secrets and full webhook/payment payloads never appear in client responses or logs;
- duplicate webhook, payment, order placement, notification, fee, and migration requests are idempotent;
- paid orders, payment amounts, dispense events, assignment history, audit records, and completed receipts cannot be silently rewritten or deleted;
- all multi-table financial/order/assignment mutations roll back atomically on a failed check;
- pagination and bulk inputs have hard limits to prevent data extraction and resource exhaustion.

## Deliberately deferred work

Deploying the relational schema does not migrate the running API. The next implementation slice is the secure connector/repository layer and its authorization test matrix, followed by the migration tooling. Firestore remains the active backend until those gates pass.

The implementation-level API architecture, source layout and route cutover matrix
are maintained in [`services/api-sql`](../services/api-sql/README.md). That folder
is intentionally not deployable until its foundation and negative authorization
tests pass.
