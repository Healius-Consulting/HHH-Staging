# London platform infrastructure

This module creates the four Cloud Run services, service accounts, Artifact Registry, serverless NEGs, Cloud Armor, global HTTPS load balancer, public-assets-only CDN backend, managed certificate, Identity Platform email/TOTP policy, Firestore session TTL, logging metrics, and alert policies.

Before planning:

1. Supply digest-pinned images for `public`, `pharmacy`, `admin`, and `api`.
2. Import the existing Identity Platform project configuration if it already exists. Review `additional_auth_domains` so Terraform does not remove an existing authorised Firebase domain.
3. Add an enabled version to the created `hhh-ip-hash-secret` in Secret Manager outside Terraform. The value must be at least 32 random bytes and is never supplied through a `.tfvars` file.
4. Build each browser image with its Firebase public configuration and reCAPTCHA Enterprise App Check site key. Register each Firebase web app with reCAPTCHA Enterprise App Check before setting `REQUIRE_APP_CHECK=true` in a reachable staging revision.
5. Point the three DNS records at `load_balancer_ip`, wait for the managed certificate to become active, and verify every HTTPS hostname before setting `enable_hsts=true`.
6. Attach real notification channels to the alert policies and configure external synthetic journeys for anonymous page rejection, login, API denial, eligibility, and payment receipt status.

Run `terraform init`, `terraform plan`, and peer review the plan. Do not apply this module directly to production until the repository [go-live checklist](../../docs/security/go-live-checklist.md) is complete.
