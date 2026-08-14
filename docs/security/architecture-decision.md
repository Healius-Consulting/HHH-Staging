# ADR-001: Fail-closed platform surfaces

Status: accepted for implementation; production activation remains gated by independent assurance.

## Decision

HHH is deployed as four independently versioned Cloud Run services in `europe-west2`: `public-web`, `pharmacy-web`, `admin-web`, and `api`. One global external Application Load Balancer maps the three user-facing hostnames and routes same-origin `/v1/*` traffic to the API. There is no public API hostname.

Every service uses `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`, has its default `run.app` URI disabled, and is reachable only through a serverless NEG. Cloud Armor is attached to every backend. CDN is enabled only for the public `/assets/*` backend; HTML and API backends have CDN disabled and emit `no-store` for protected or sensitive responses.

The pharmacy and admin gateways authenticate a Firebase server session and its server-side `staffSessions` record before returning protected HTML. Anonymous page requests receive a `303` to `/login` with a validated relative return target. Anonymous API calls receive JSON `401`; role/surface mismatches receive `403`; tenant record mismatches receive `404`.

Production authentication is `cookie-enforced`. Bearer modes exist only to observe and validate the migration in non-production environments. A rollback may move traffic to an earlier cookie-capable revision, but may not restore bearer-only production access.

## Consequences

- A copied SPA URL cannot bypass the protected-page check.
- Pharmacy and administration ship as different build artefacts and host-only cookies cannot be sent across their hostnames.
- Load-balancer, gateway, API, and repository checks remain independently testable controls.
- Firebase Authentication, App Check, Firestore, Cloud Armor, TLS, DNS, logging, and alerting must be configured before the application can be promoted.
- This repository does not claim invulnerability. Production remains blocked until penetration testing, DPIA, operational recovery, partner, regulatory, and legal gates are signed off.

## Implementation map

- Protected gateway: `services/web/src/server.ts`
- Session/CSRF boundary: `services/api/src/session-auth.ts`
- Authentication middleware: `services/api/src/auth.ts`
- Overview computation: `services/api/src/pharmacy-overview.ts`
- Cloud resources: `infra/terraform`
- Surface builds: `apps/public`, `apps/pharmacy`, `apps/admin`
