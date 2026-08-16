# Intended source layout

This directory records the implementation boundary before source files are
introduced. The foundation PR should create only the modules it can fully test.

```text
src/
  bootstrap/
    config.ts                 validated runtime configuration
    firebase.ts               Auth, App Check, Storage and Data Connect setup
    create-app.ts             Express composition only
  security/
    request-context.ts        immutable actor, surface and tenant scopes
    require-staff.ts          cookie/token/App Check/session verification
    csrf.ts                   unsafe-method origin and CSRF controls
    admission.ts              staff/session scope comparison
  transport/
    public/                   public routers and Zod transport schemas
    portal/                   pharmacy routers
    admin/                    HHH admin routers
    webhooks/                 provider-specific verified ingress
  application/
    tenancy/
    intake/
    patients/
    prescriptions/
    orders/
    payments/
    integrations/
    fulfilment/
    finance/
    notifications/
  domain/
    pure state transitions, value objects and invariants
  repositories/
    ports/                    storage-independent interfaces
    sql/                      generated-operation adapters and row mappers
  providers/
    storage/
    secrets/
    worldpay/
    curaleaf/
    messaging/
  workers/
    thin scheduled/task entry points invoking application services
  migration/
    inventory, transform, dry-run, ledger, backfill and reconciliation tools
  observability/
    privacy-safe audit, metrics and structured logging
  testing/
    synthetic fixtures, tenant matrix and emulator helpers
```

## Import rules

- `domain` imports no other application layer and has no Firebase/Express types.
- `application` imports domain types and repository/provider ports only.
- `repositories/sql` is the only runtime location importing the generated Data
  Connect Admin SDK.
- `transport` may import application services and security middleware, never SQL
  adapters directly.
- `workers` invoke application services; they do not import route handlers.
- `migration` may use reviewed bulk/admin APIs but is not bundled into the HTTP
  or worker deployment.
- Firestore imports are prohibited in this tree. The migration bridge remains in
  the old service or a separately executed migration tool until cutover.

## Naming rules

- Use cases are verbs: `allocateEligibility`, `createOrder`, `recordGoodsReceipt`.
- Repository methods describe guarded intent: `findTenantOrder`,
  `transitionPayment`, `appendPlacementEvent`.
- SQL operations include context and action: `PortalListOrders`,
  `AdminAllocateEligibility`, `WorkerClaimNotifications`.
- Avoid `getAny`, `listAll`, `updateRecord`, generic collection/table names and
  optional tenant arguments.

## Error contract

Infrastructure errors map to a small application error set. Transport preserves
the existing API codes/statuses. In particular:

- missing and cross-tenant records both become `404 NOT_FOUND`;
- optimistic conflicts become `409 CONFLICT` with no hidden row data;
- invalid state transitions become `409` domain errors;
- authentication failures remain generic and do not reveal whether a staff,
  session, tenant, token or patient record exists;
- provider failures return stable safe codes while detailed, scrubbed diagnostics
  remain server-side.
