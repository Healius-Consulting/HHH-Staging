# Firebase and Vercel deployment runbook

This repository supports three independently configured surfaces:

1. **Staff portal** — Vercel project using `vercel.json`, output `dist`.
2. **Public eligibility form** — currently served by the staff bundle at `?mode=eligibility`; `vercel.eligibility.json` remains available if it is separated into its own Vercel project later.
3. **Authenticated API** — Firebase Functions in `europe-west2`, with Firestore, App Check and Secret Manager.

For the temporary staging setup, the staff portal and public eligibility form share `https://hhh.thinktimeless.co.uk`. Eligibility links use `?mode=eligibility`, and Vercel proxies `/api/*` to the Firebase Function so the browser sees one public domain.

Production must start with empty patient, referral and order collections. The React seed records are enabled only in local Vite development when Firebase is not configured.

## Firebase project setup

- Create separate Firebase projects for development/staging and production.
- Enable email/password for staff. TOTP is available but may remain disabled during the private staging demo; before enforcing it, upgrade Authentication with Identity Platform and set both MFA environment flags to `true`.
- Create the web app and copy only the public Firebase web configuration into Vercel environment variables.
- Register both Vercel domains for App Check and Firebase Authentication authorised domains.
- Deploy the Firestore indexes/rules, Storage rules and Functions from the repository root.
- Grant the Functions runtime service account the minimum Secret Manager accessor role for the named integration secrets.
- Never put Curaleaf API keys or Worldpay merchant secrets in `VITE_*` variables.
- The API can be deployed before Curaleaf supplies pharmacy keys, so eligibility and onboarding testing are not blocked. Pharmacy activation stores that pharmacy’s internal customer ID, portal email, required read/write key and optional read-only key in its own Europe-hosted secret. Live tenant requests never fall back to a platform or another pharmacy’s key; legacy customer-ID-only connections show `credential_update_required` until rotated.
- Enable Cloud Tasks and grant the Functions runtime service account `cloudtasks.tasks.create` plus permission to invoke `pollCuraleafEventsLondon`. Keep `CURALEAF_EVENT_POLLING_ENABLED=false` through the first deployment, enter and verify per-pharmacy keys, then set it to `true` and redeploy.

Example deployment after selecting the correct Firebase project:

```bash
firebase use <project-id>
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

## Staff portal Vercel project

- Import the repository with the root directory left at the repository root.
- Use `vercel.json` (the default).
- Configure the Firebase web values, API URL and App Check site key from `.env.example`.
- Keep Preview and Production values separate. Preview must point only at the non-production Firebase project.
- For the temporary shared-domain deployment, set `VITE_API_BASE_URL=https://hhh.thinktimeless.co.uk/api` and `VITE_ELIGIBILITY_FORM_URL=https://hhh.thinktimeless.co.uk`.

## Eligibility Vercel project

- Import the same repository as a second Vercel project.
- Keep the repository root as the project root.
- Set the build command to `npm run build:eligibility` and output directory to `dist-eligibility`, or deploy with `vercel --local-config vercel.eligibility.json`.
- Configure `VITE_API_BASE_URL` plus the public Firebase web/App Check values from `.env.example`. The eligibility application uses App Check but does not receive staff credentials or initialise a patient account flow.

## Access boundary

Firebase Auth, verified ID tokens, role/organisation claims, App Check and tenant checks are the application security boundary. A normal Vercel deployment does not provide a dependable end-to-end IP allowlist for this architecture. Add an upstream access proxy or an appropriate Vercel enterprise control later if IP restriction becomes mandatory.

## Go-live checks

- Create users through the HHH admin process only; there is no patient sign-up.
- Confirm an unactivated pharmacy sees the training banner and dummy records, can practise every workflow, and loses all dummy mutations on refresh without any patient/order writes in Firestore.
- Submit the external Curaleaf onboarding form, then have an HHH administrator enter the returned internal customer/PHAR ID, portal email and pharmacy API key(s) through the admin-only integration form. Pharmacy staff never receive or view those fields.
- Confirm each connected pharmacy has a fresh event-worker heartbeat, ~60-second cursor movement, 1.1-second supplier request spacing and tested `429` recovery.
- Verify every staff email before granting workspace access. For the initial staging demo, set `VITE_REQUIRE_MFA=false` and `REQUIRE_MFA=false`; enable both together when mandatory TOTP is introduced.
- Test that a pharmacy user cannot read or mutate another organisation by changing request identifiers.
- Confirm setup-incomplete staff can open Dashboard, Setup and Resources but cannot submit orders, access patient records or configure live payment actions.
- Complete one manual-payment UAT and one Worldpay HPP sandbox UAT per pharmacy.
- Complete Curaleaf manual/barcode submission UAT, dispatch reconciliation, partial goods-in, full goods-in and collection-ready checks.
- Before Go live, confirm the owning company has signed GDPR/data-sharing evidence linked from Google Drive/Docs and validate/store the branch LIVE Curaleaf key. Operational setup tasks and TEST-key validation do not unlock production.
- Configure `PATIENT_MESSAGE_PROVIDER_URL` and `PATIENT_MESSAGE_PROVIDER_KEY`. Configure the Curaleaf hold, renewal-attach and line-exclusion URL templates only after Curaleaf supplies their contracts; absent templates intentionally leave staff holds open.
- For this rollout, run `POST /v1/portal/admin/migrations/master-flow-v2` and then `POST /v1/portal/admin/go-live/audit` with a freshly authenticated HHH admin session.
- Confirm audit logs exist for authentication, setup, secret changes, order submission, goods-in, readiness and collection.
