# Security data flow

```mermaid
flowchart LR
  Browser["Browser"] -->|"HTTPS: www / pharmacy / admin"| Armor["Global load balancer + Cloud Armor"]
  Armor -->|"public pages and immutable assets"| Public["public-web"]
  Armor -->|"session checked before HTML"| Pharmacy["pharmacy-web gateway"]
  Armor -->|"session checked before HTML"| Admin["admin-web gateway"]
  Armor -->|"same-origin /v1/*"| API["API: auth + policy boundary"]
  Pharmacy --> Auth["Firebase Auth + staffSessions"]
  Admin --> Auth
  API --> Auth
  API -->|"server-derived tenant"| Store["Firestore / Storage deny browser access"]
  API -->|"outbound integration"| Partners["Worldpay / Curaleaf"]
  Partners -->|"signed webhook / reconciliation"| API
```

Session establishment sends a recent Firebase ID token, App Check token, and CSRF token to the API. The API verifies email, TOTP, role, surface, organisation, and active staff state; creates an eight-hour session cookie; stores only its hash in `staffSessions`; and the browser signs out of Firebase. Subsequent requests use the host-only HttpOnly cookie. Unsafe requests also require the matching CSRF header and valid request-origin evidence.

The Pharmacy Overview receives a purpose-built aggregate response. Record opening causes a separate authorised detail read; summary cards never load full patient or order collections.
