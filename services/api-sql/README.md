# SQL API rewrite workspace

Status: live backend deployed as apiLondon (Firebase Functions in this folder).

The live backend is `services/api-sql`. The former `services/api` Firestore
service remains in the repo as a legacy/archived reference only during cutover.

## Why this is separate

The current API contains 105 Express route declarations, 24 modules with direct
Firestore dependencies, and 12 scheduled/task workers. Replacing imports inside
that code in place would mix two storage models and make authorization review,
rollback, and parity testing difficult.

The SQL implementation will therefore be built beside the current service and
promoted by bounded context. The Firestore API stays authoritative until every
slice passes its migration, authorization, parity, and rollback gates.

## Fixed decisions

- Keep Express and the existing HTTP paths during the migration. The front ends
  should not need a simultaneous rewrite.
- Keep Firebase Authentication, App Check, secure session cookies, TOTP MFA,
  CSRF/origin checks, private Cloud Storage, and Secret Manager.
- Use the Firebase Admin SQL Connect SDK only from trusted server runtimes.
- Define small, named server operations. Do not use generic CRUD or arbitrary
  GraphQL from request handlers.
- Mark server connector operations `@auth(level: NO_ACCESS)`. No browser SDK is
  generated from the server connector.
- Treat Admin SDK calls as privileged: authorization is completed before a
  repository call, and every tenant repository operation also includes the
  verified organisation ID in its SQL filter.
- Never accept a request body, path, or query organisation ID as the authority
  for pharmacy staff. Tenant scope comes from the verified session.
- Keep the old API deployable until the final rollback window has expired.

## Documents

- [`PLAN.md`](PLAN.md) defines the target architecture, security controls,
  implementation phases, schema follow-ups, tests, and cutover rules.
- [`ROUTE-CUTOVER.md`](ROUTE-CUTOVER.md) groups the current endpoints and workers
  into migration slices with explicit entry and exit gates.
- [`src/README.md`](src/README.md) is the intended source tree and dependency
  direction for implementation.

## Promotion rule

This directory must not be added to `package.json` workspaces, Firebase exports,
Vercel rewrites, or production configuration until the foundation slice has:

1. a compiling TypeScript package;
2. a generated server-only SQL Connect SDK;
3. emulator-backed repository and negative authorization tests;
4. no exported HTTP routes other than a private test health check; and
5. an approved feature-flag and rollback mechanism.

## First implementation pull request

The first implementation PR should contain only the foundation:

- schema hardening fields and migration-control tables described in `PLAN.md`;
- the server-only SQL Connect connector and generated Admin SDK;
- request identity and tenant-scope types;
- Data Connect initialization;
- one read-only repository operation exercised against the emulator; and
- tests proving that tenant scope cannot be supplied by an untrusted input.

It should not move live routes or write production data.
