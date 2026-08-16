# V2 intake and directory rollout

The v2 implementation is additive. It does not backfill or rewrite schema-v1 eligibility submissions or existing referral-token documents.

## Runtime controls

- `V2_PUBLIC_INTAKE_ENABLED=false` keeps token-free postcode search and v2 submission unavailable. Legacy token resolution and v1 submission remain available.
- `V2_DIRECTORY_ADMIN_ENABLED=false` hides directory management at the API boundary.
- Postcodes.io is called only from the Firebase API through its bulk `POST` endpoint and requires no API key. Only the postcode is sent; patient identity, contact details, answers, browser IP and referer are not forwarded.
- Commercial Northern Ireland postcode-data use requires separate licensing. Until approved, `BT` searches return the normal provider-unavailable/manual-allocation path without contacting Postcodes.io.

Both feature flags must be set explicitly in each deployed environment. Disabling them is the v2 rollback; do not delete directory, search-session, overlay, assignment-event or v2 submission documents.

## Safe rollout order

1. Deploy the API and Firestore indexes with both flags disabled.
2. Verify the protected-token fixture and all legacy URL shapes. Production smoke tests resolve tokens only and never submit a form.
3. Enable directory administration in staging and create a synthetic real-classified pharmacy profile.
4. Submit, review and publish the staging profile explicitly, then activate its stable v2 token.
5. Exercise HHH-only intake, follow-up, main-site final allocation, dedicated-link destination locking, direct pharmacy-patient activation, v2 pharmacy-eligibility exclusion, and the concurrent first-order lock.
6. Enable public intake in production with no published profiles. Provider failure/no-match should create HHH-only cases.
7. Create profiles for selected real pharmacies. Every profile requires a separate submit-for-review and publish action. Eastwood and K-Chem receive no automatic profile.
8. Run `npm run migrate:primary-allocation-holding -- --project <project-id>` as a dry run, verify the non-patient counts, then repeat with `--apply`. This changes only Primary's organisation classification and appends a non-PII audit event; it does not rewrite submissions, patients, orders, prescriptions, payments or referral-token documents.
9. Keep every existing dedicated token and URL unchanged, but resolve new submissions through the HHH-first v2 intake. The source pharmacy is immutable for each dedicated link. The case remains HHH-only until an administrator completes follow-up and explicitly refers it to that source pharmacy. Successful referral creates or links the pharmacy patient directly; v2 cases never enter a pharmacy eligibility-review queue.
10. Existing schema-v1 submissions, patients and orders are not rewritten. Primary's synthetic patients and Curaleaf TEST orders remain intact. Primary and Alternate stay excluded from the public map and general allocation candidates, while their protected dedicated links continue to submit to HHH with a fixed destination.

## External release gates

- Approved `general-public-v2.1` and `pharmacy-qr-v2.1` consent wording. The API temporarily accepts source-matched v2.0 consent during the client rollout, but new clients render v2.1.
- Postcodes.io privacy/DPIA and sub-processor-register assessment, plus Northern Ireland commercial licensing before enabling automated `BT` lookup.
- Penetration test and accessibility acceptance.
- Production pharmacy approval before each profile is published.

## Operational monitoring

`providerMetrics` contains only provider name, operation, outcome, duration, attempt count and time. It never contains a postcode or patient/contact data. Monitor provider unavailable/not-found outcomes, latency, assignment conflicts, tenant-denial `404`s, queue age and downstream assignment-lock denials. Assignment events deliberately carry IDs, versions and `notePresent` only; the private note remains on the protected case.
