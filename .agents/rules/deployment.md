# Deployment guidelines

This git repository (`Healius-Consulting/holistichealthhub-main`) is **production**. Hosting topology is in [`.agents/skills/production-hosting/SKILL.md`](../skills/production-hosting/SKILL.md): live public is `holistichealthhub.cc`; Hobby staging is `staging.thinktimeless.co.uk`; `hhh.thinktimeless.co.uk` is a Cloudflare 301 for two printed pharmacy QR codes, not a Vercel app.

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

## Production Vercel (HHH team)

Two projects from this repo, root `./`, never `services/api`:

| Surface | `HHH_SURFACE` | Domain |
|---|---|---|
| Public | `public` | `holistichealthhub.cc` |
| Portal | `portal` | `portal.holistichealthhub.cc` |

Add each domain once on the matching HHH project. Production deploys follow the project domain automatically — never `vercel alias`, never `*.vercel.app`.

Hobby `hhh-staging-*` projects are staging only (`staging.thinktimeless.co.uk`). Do not put production `.cc` domains or `hhh.thinktimeless.co.uk` on Hobby.

Verify: `curl -sI https://portal.holistichealthhub.cc` and `curl -sI https://holistichealthhub.cc`.
