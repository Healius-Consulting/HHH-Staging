# Firebase and Vercel deployment runbook

This repository supports three independently configured surfaces:

1. **Staff portal** — Vercel project using `vercel.json`, output `dist`.
2. **Public eligibility form** — a second Vercel project using `vercel.eligibility.json`, output `dist-eligibility`.
3. **Authenticated API** — Firebase Functions in `europe-west2`, with Firestore, Storage, App Check and Secret Manager.

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
- The API can be deployed before Curaleaf supplies HHH’s key, so eligibility and onboarding testing are not blocked. Once the key arrives, create the single `CURALEAF_API_KEY` value in Secret Manager and grant the Functions runtime service account access to that named secret. Pharmacy activation then stores only that pharmacy’s customer ID and returned portal email in its Europe-hosted secret.

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
- Submit the external Curaleaf onboarding form, then have an HHH administrator enter the returned customer ID and portal email. The pharmacy must not receive an API-key field.
- Verify every staff email before granting workspace access. For the initial staging demo, set `VITE_REQUIRE_MFA=false` and `REQUIRE_MFA=false`; enable both together when mandatory TOTP is introduced.
- Test that a pharmacy user cannot read or mutate another organisation by changing request identifiers.
- Confirm setup-incomplete staff can open Dashboard, Setup and Resources but cannot submit orders, access patient records or configure live payment actions.
- Complete one manual-payment UAT and one Worldpay HPP sandbox UAT per pharmacy.
- Complete Curaleaf manual/barcode submission UAT, dispatch reconciliation, partial goods-in, full goods-in and collection-ready checks.
- Confirm audit logs exist for authentication, setup, secret changes, order submission, goods-in, readiness and collection.
