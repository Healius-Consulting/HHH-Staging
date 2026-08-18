---
name: production-hosting
description: Production vs staging hosting for Holistic Health Hub. This git is production. Hobby Vercel is staging on staging.thinktimeless.co.uk. hhh.thinktimeless.co.uk is not Vercel — it is a Cloudflare 301 for two printed pharmacy QR hosts onto holistichealthhub.cc. Use when deploying, attaching domains, changing Cloudflare DNS, eligibility QR/token URLs, or deciding whether to delete Vercel projects.
---

# Production hosting

This git is **production**. Hobby Vercel is **staging**. Do not deploy production traffic from the personal/Hobby account.

## What each hostname is

| Hostname | What it is | What it is not |
|---|---|---|
| `holistichealthhub.cc` | Live **public** site and eligibility forms. HHH Vercel team, `HHH_SURFACE=public`. | Not staging. Not Think Timeless. |
| `portal.holistichealthhub.cc` | Live **staff portal** (pharmacy + admin). HHH Vercel team, `HHH_SURFACE=portal`. | Not the public site. |
| `hhh.thinktimeless.co.uk` | **Printed pharmacy QR host only.** Cloudflare Single Redirect, 301, query string preserved, onto `holistichealthhub.cc`. Proxied dummy DNS (`AAAA 100::`). No Vercel project. | Not staging. Not a website. Do not attach it to any Vercel project. Do not point it at Hobby. |
| `staging.thinktimeless.co.uk` | **Hobby public staging.** Personal Vercel, DNS-only CNAME to that project's `*.vercel-dns-017.com`. | Not production. Not the pharmacy QR host. |
| `portal.hhh.thinktimeless.co.uk` | Legacy Hobby **portal** staging, if still attached. Prefer moving it to a `staging` hostname later. | Not production portal. |

`ha.thinktimeless.co.uk` is Home Assistant. Apex `thinktimeless.co.uk` has no HHH site. Company mail stays on that zone (Google MX).

### `hhh` (pharmacies)

Eastwood and K-Chem printed this shape. Never reprint:

`https://hhh.thinktimeless.co.uk/?mode=eligibility&token=<token>`

Stone tokens:

- `https://hhh.thinktimeless.co.uk/?mode=eligibility&token=bbd8fc4749934797a49398c0b95e68cf873d4868c33c42a2949d6f65359d44c5`
- `https://hhh.thinktimeless.co.uk/?mode=eligibility&token=0a93ebde7ab143cfafd7c2a34329b3587148fb1ff9fb4e6fbf02f517fac05d30`

Cloudflare (thinktimeless zone) **Rules → Overview → Create rule → Redirect Rule**, wildcard:

- Request URL: `https://hhh.thinktimeless.co.uk/*`
- Target: `https://holistichealthhub.cc/${1}`
- 301, preserve query string

Patients land on `https://holistichealthhub.cc/?mode=eligibility&token=…`. The public app must treat `/?mode=eligibility&token=` as eligibility, and accept the historical `/?mode=eligibility?token=` typo. Do not orange-cloud a Vercel CNAME; `hhh` is not on Vercel.

### `staging`

Hobby public preview only. Forms there must not be given to pharmacies. Add `https://staging.thinktimeless.co.uk` to API CORS (`isOriginPermitted` / `ALLOWED_ORIGINS`). Do not 301 `staging` to production.

## Environments

| | Production | Staging |
|---|---|---|
| Git | `Healius-Consulting/holistichealthhub-main` (this repo) | Same history may lag; treat Hobby deploys as non-live |
| Vercel team | **HHH** (`hhh-d25f`) | Personal Hobby (`mihirp01s-projects` / thinkTimeless) |
| Public | `https://holistichealthhub.cc` | `https://staging.thinktimeless.co.uk` |
| Portal | `https://portal.holistichealthhub.cc` | Hobby portal project (not `hhh.`) |
| Surfaces | Two HHH projects: `HHH_SURFACE=public` and `HHH_SURFACE=portal` | `hhh-staging-api` (public) and `hhh-staging-portal` |
| API | `apiLondon` on Firebase `hhh26-4ebd2` | Same Firebase until a dedicated staging project exists |

Canonical public origin in code is **`holistichealthhub.cc`**, not `.co.uk`. `VITE_APP_ENV` is unused. Production-ness is the hostname, Vercel team, and `HHH_SURFACE`.

## Deploy production (HHH team)

Two projects from this repo, root `./`, never `services/api`.

1. **Public** — `HHH_SURFACE=public` → domain `holistichealthhub.cc` only (not `hhh.thinktimeless.co.uk`)
2. **Portal** — `HHH_SURFACE=portal` → domain `portal.holistichealthhub.cc`

Attach each custom domain **once**. Production deploys update `.cc` automatically. Do **not** run `vercel alias`. Ignore `*.vercel.app`.

```bash
firebase use hhh26-4ebd2
firebase deploy --only functions
```

Do not deploy Firestore.

## Staging (Hobby)

Keep `hhh-staging-api` / `hhh-staging-portal` on the personal Vercel account:

- Public staging: `https://staging.thinktimeless.co.uk` (DNS-only CNAME)
- Do not put `holistichealthhub.cc`, `portal.holistichealthhub.cc`, or `hhh.thinktimeless.co.uk` on Hobby

## Code that must keep knowing `hhh`

Even though Cloudflare redirects first, keep these so a missed DNS change cannot send pharmacies to a blank origin:

- `apps/public/src/publicRoute.ts` — `LEGACY_ELIGIBILITY_HOSTS` includes `hhh.thinktimeless.co.uk` and JS-canonicalises to `https://holistichealthhub.cc/eligibility?token=…`
- `vercel.ts` — host redirects for `hhh` / `www.hhh` to `.cc` (only if that hostname is ever attached to a Vercel public project; live path is Cloudflare)
- `services/api-sql` CORS allows `hhh.thinktimeless.co.uk` and `staging.thinktimeless.co.uk`

Do not add `staging.thinktimeless.co.uk` to `LEGACY_ELIGIBILITY_HOSTS`. Staging must not bounce to production.

## What not to do

- Do not treat `hhh.thinktimeless.co.uk` as staging.
- Do not attach `hhh` to Vercel (Hobby or HHH).
- Do not orange-cloud Vercel CNAMEs (`staging` stays DNS-only / grey).
- Do not delete the Cloudflare redirect or the `hhh` proxied dummy record.
- Do not point anything at `holistichealthhub.co.uk` unless that domain is actually live.
