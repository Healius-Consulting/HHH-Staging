# Deployment guidelines

Live order, fulfilment, and storage metadata traffic is **Firebase SQL Connect** (`dataconnect/` + `services/api-sql`) on project `hhh26-4ebd2` in `europe-west2`.

## Never deploy Firestore

Do **not** run `firebase deploy --only firestore`, `firestore:rules`, or `firestore:indexes`.
Do **not** treat `services/api` as the live order backend. The Cloud Function source is `services/api-sql`.

Firebase Auth, App Check, Secret Manager, and private Cloud Storage may remain.

## SQL Connect / api-sql

```bash
firebase use hhh26-4ebd2
firebase deploy --only dataconnect,functions
```

If Cloud SQL schema is behind the checked-in GraphQL, migrate first:

```bash
firebase dataconnect:sql:migrate --service hhh-platform-service
```

`dataconnect/dataconnect.yaml` uses `schemaValidation: COMPATIBLE` so unknown database objects are not dropped.

## Vercel custom-domain aliasing

Whenever deploying the platform to Vercel:

1. **Deploy Production Bundle**:
   - Run `npx vercel deploy --prod --yes`
2. **Explicitly Assign Custom Domain Aliases**:
   - For Portal deployments (`hhh-staging-portal`):
     ```bash
     npx vercel alias set <deployment-url> portal.holistichealthhub.cc
     ```
   - For Public / API deployments (`hhh-staging-api`):
     ```bash
     npx vercel alias set <deployment-url> holistichealthhub.cc
     ```
3. **Verify Domain Attachment & DNS Resolution**:
   - Verify HTTP headers with `curl -s -I https://portal.holistichealthhub.cc` or `npx vercel domains verify <domain>` to ensure live traffic reaches the updated build immediately.
