---
name: production-hosting
description: Production hosting for Holistic Health Hub. GitHub main on Healius-Consulting/holistichealthhub-main auto-deploys the HHH Vercel team (holistichealthhub.cc + portal). hhh.thinktimeless.co.uk is a Cloudflare 301 for printed pharmacy QR codes, not Vercel. Hobby Vercel staging is retired. Use when deploying, attaching domains, changing Cloudflare DNS, eligibility QR/token URLs, or API function releases.
---

# Production hosting

**Single live frontend path:** push to `main` on `Healius-Consulting/holistichealthhub-main` → HHH Vercel team auto-deploys both surfaces. There is no separate Hobby staging Vercel anymore.

**API:** `apiLondon` on Firebase `hhh26-4ebd2` does **not** auto-deploy from GitHub — run `firebase deploy --only functions` when `services/api-sql` changes.

## What each hostname is

| Hostname | What it is | What it is not |
|---|---|---|
| `holistichealthhub.cc` | Live **public** site and eligibility forms. HHH Vercel, `HHH_SURFACE=public`. | Not Think Timeless. |
| `portal.holistichealthhub.cc` | Live **staff portal** (pharmacy + admin). HHH Vercel, `HHH_SURFACE=portal`. | Not the public site. |
| `hhh.thinktimeless.co.uk` | **Printed pharmacy QR host only.** Cloudflare Single Redirect, 301, query string preserved, onto `holistichealthhub.cc`. Proxied dummy DNS (`AAAA 100::`). No Vercel project. | Not a website. Do not attach to Vercel. |
| `staging.thinktimeless.co.uk` | **Retired.** Was Hobby public staging; project shut down. Remove or leave DNS dormant — do not use for UAT. | Not live. |

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

## Environment

| | Live |
|---|---|
| Git | `Healius-Consulting/holistichealthhub-main` — push `main` to deploy frontend |
| Vercel team | **HHH** (`hhh-d25f`) — two projects, auto-deploy from GitHub |
| Public | `https://holistichealthhub.cc` |
| Portal | `https://portal.holistichealthhub.cc` |
| Surfaces | `HHH_SURFACE=public` and `HHH_SURFACE=portal` |
| API | `apiLondon` on Firebase `hhh26-4ebd2` — manual `firebase deploy --only functions` |

Canonical public origin in code is **`holistichealthhub.cc`**, not `.co.uk`. `VITE_APP_ENV` is unused. Production-ness is the hostname, Vercel team, and `HHH_SURFACE`.

## Deploy frontend (HHH Vercel)

Two projects from this repo, root `./`, never `services/api`:

1. **Public** — `HHH_SURFACE=public` → `holistichealthhub.cc`
2. **Portal** — `HHH_SURFACE=portal` → `portal.holistichealthhub.cc`

Attach each custom domain **once**. GitHub pushes to `main` update `.cc` automatically. Do **not** run `vercel alias`. Ignore `*.vercel.app` for staff UAT.

```bash
git push staging main   # remote: Healius-Consulting/holistichealthhub-main
```

## Deploy API

```bash
firebase use hhh26-4ebd2
firebase deploy --only functions
```

Do not deploy Firestore.

## Code that must keep knowing `hhh`

Even though Cloudflare redirects first, keep these so a missed DNS change cannot send pharmacies to a blank origin:

- `apps/public/src/publicRoute.ts` — `LEGACY_ELIGIBILITY_HOSTS` includes `hhh.thinktimeless.co.uk` and JS-canonicalises to `https://holistichealthhub.cc/eligibility?token=…`
- `vercel.ts` — host redirects for `hhh` / `www.hhh` to `.cc` (backstop if that hostname is ever attached to Vercel; live path is Cloudflare)
- `services/api-sql` CORS allows `hhh.thinktimeless.co.uk` (printed QR origin before redirect)

## What not to do

- Do not treat `hhh.thinktimeless.co.uk` as staging.
- Do not attach `hhh` to Vercel.
- Do not recreate Hobby staging unless you explicitly want a second Vercel account again.
- Do not delete the Cloudflare redirect or the `hhh` proxied dummy record.
- Do not point anything at `holistichealthhub.co.uk` unless that domain is actually live.
