# Separately hosted eligibility form

The repository now produces three independently deployable services:

```text
portal.holistichealthhub.co.uk       root Vite app → dist/
eligibility.holistichealthhub.co.uk  apps/eligibility → dist-eligibility/
api.holistichealthhub.co.uk          services/api → services/api/dist/
                                      │
                                      └── PostgreSQL
```

The referral token is a public routing identifier. The API stores only its SHA-256 hash, resolves it to an organisation, and writes `organisation_id` and `referral_token_id` onto every submission. Portal access must use authenticated staff identity; knowing a referral token never grants access to patient data.

## Local setup

No database or environment file is required for the basic connected development flow. The API automatically uses temporary in-memory storage and localhost development settings. Start each process in a separate terminal:

```bash
npm run dev:api
npm run dev
npm run dev:eligibility
```

Portal: `http://localhost:5173`  
Eligibility form: `http://localhost:5174/?token=hhh-leeds-7x4p9k`  
API health check: `http://localhost:8080/health`

Submissions will travel from the separate form to the API and into the portal, but reset whenever the API restarts.

To test PostgreSQL persistence, create database `hhh`, apply `services/api/migrations/` in numerical order, copy `services/api/.env.example` to `services/api/.env`, and set `DATABASE_URL`. Copy the root `.env.example` only when overriding the default localhost URLs or development access token.

## Production builds

```bash
npm run build:all
```

| Deployment | Build command | Output/start command |
|---|---|---|
| Portal static site | `npm run build` | `dist/` |
| Eligibility static site | `npm run build:eligibility` | `dist-eligibility/` |
| API service | `npm run build:api` | `npm run start --workspace @hhh/api` |

Build the two frontends with:

```dotenv
VITE_API_BASE_URL=https://api.holistichealthhub.co.uk
VITE_ELIGIBILITY_FORM_URL=https://eligibility.holistichealthhub.co.uk
```

Configure the API runtime with:

```dotenv
DATABASE_URL=postgresql://...
ALLOWED_ORIGINS=https://portal.holistichealthhub.co.uk,https://eligibility.holistichealthhub.co.uk
NODE_ENV=production
```

Do not set `VITE_PORTAL_ACCESS_TOKEN` in production. It is only a development bridge. Replace `requirePortalAccess` in `services/api/src/index.ts` with JWT/session verification from the chosen staff identity provider. The verified identity must supply `organisation_id`; production code must not trust an organisation ID sent by the browser.

## Pharmacy links and QR codes

The portal reads `VITE_ELIGIBILITY_FORM_URL`, then generates links such as:

```text
https://eligibility.holistichealthhub.co.uk/?token=emp-lincoln-3m8q2v
```

The copied link, QR image and content-pack ZIP all point to the separately hosted form automatically. Pharmacy developers design their own information page and link/button, but must not iframe, copy or rebuild the form. Changing the environment variable and rebuilding the portal is sufficient; no component code needs changing.

## Before live patient data

- Replace the development portal token with real staff authentication and MFA.
- Add database roles and enforce tenant row-level security policies using the authenticated organisation context.
- Put the API behind a managed WAF and monitoring; keep the included application rate limit.
- Use managed PostgreSQL in the approved UK region with encrypted backups.
- Complete the DPIA, DPA, privacy notice, consent approval and retention/deletion jobs.
- Add audit logging for staff access and administrative token rotation/revocation.
- Run penetration, tenant-isolation and accessibility testing.
