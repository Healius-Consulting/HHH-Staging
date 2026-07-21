# ADR — Centrally hosted eligibility form with link-out only

**Status:** Accepted  
**Decision:** Pharmacy websites do not embed, iframe, copy or rebuild the eligibility form.

HHH hosts one maintained eligibility application on its own form domain. Each pharmacy receives a unique public URL containing its referral token:

```text
https://eligibility.holistichealthhub.co.uk/?token=<pharmacy-token>
```

The pharmacy or its web developer may design its own information page and call-to-action. The button must link to the exact URL supplied by HHH. The same URL is encoded in the downloadable QR image for website, leaflet, poster and approved digital use.

The token is resolved by the HHH API and the resulting `organisation_id` is stored with the submission. The token routes intake; it never grants portal access.

This decision supersedes earlier references to hardened iframe embeds, embed snippets, resizer scripts and pharmacy-hosted form markup in older planning documents.
