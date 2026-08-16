# Go-live security checklist

This file is a release gate, not a claim that the checked-in implementation alone is production-ready.

- [ ] Identity Platform is enabled and TOTP enrolment is mandatory for pharmacy and admin staff.
- [ ] All protected route, cookie, revocation, return-target, CSRF, origin, App Check, role, and tenant tests pass in staging.
- [ ] Vercel account is on a plan permitted for client/commercial use and owned by the correct legal entity; Hobby is not used for the live service.
- [ ] Every Vercel alias/custom hostname receives the same fail-closed page and API checks; exact host allow-lists are verified.
- [ ] DNS and managed TLS serve only the three intended hostnames; HSTS is enabled after verification.
- [ ] Vercel Firewall protections and spend controls are reviewed; only immutable fingerprinted assets demonstrate cache hits.
- [ ] Firestore and Storage browser rules are deny-all; service-account IAM is independently reviewed.
- [ ] Public, pharmacy, and admin image/bundle contents are scanned and separated.
- [ ] Security logs are PII-minimised and alerts reach an on-call owner.
- [ ] Synthetic checks cover anonymous protected pages, valid login, API denial, public eligibility, and payment receipt status.
- [ ] Worldpay webhook and Payment Query reconciliation are proven authoritative; a return URL cannot mark payment paid.
- [ ] Backup, restore, revocation, staff disablement, MFA reset, key rotation, and incident response exercises are complete.
- [ ] Dependency, secret, Vercel build, and applicable infrastructure scanning pass in CI.
- [ ] Independent penetration test findings are resolved or formally risk accepted.
- [ ] DPIA, retention, GPhC, GDPR/legal entity, Worldpay, Curaleaf, and London residency approvals are signed.
