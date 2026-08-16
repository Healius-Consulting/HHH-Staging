# Frontend hosting cost comparison

## Scope and assumptions

This comparison covers hosting for:

- The public frontend at `www.<base-domain>`
- The authenticated private hub at `portal.<base-domain>`

The estimates assume:

- Early-stage traffic
- Less than 10 GB of frontend data transfer per month
- Fewer than 1 million protected-page requests per month
- One developer with deployment access
- Firebase database, authentication, storage and API costs are excluded because they are broadly shared across the frontend hosting options

Prices are approximate, quoted in USD, and should be rechecked before committing to a provider.

## Cost summary

| Option | Approximate monthly cost | Practical impact |
|---|---:|---|
| Vercel Hobby | $0 | Suitable only for personal, non-commercial development using synthetic data |
| Vercel Pro | $20 | Covers both public and portal projects under one team, with one deploying seat |
| Firebase Hosting and scale-to-zero Cloud Run | $0–10 | Cheapest credible option, but requires migration and security regression testing |
| Cloudflare Pages and Workers | $5+ | Low raw cost, but suitable regional controls may require a custom-priced Enterprise agreement |
| Netlify Pro | $20+ | Similar base price to Vercel, with migration work and credit-based usage |
| AWS Amplify | $0–10 basic; $15+ with WAF | Low hosting cost, but requires substantial private-gateway migration |
| Full Google Cloud frontend topology | $40–60 | Includes Cloud Run, load balancing, Cloud Armor and CDN infrastructure |
| Current complete Google Cloud Terraform stack | Approximately $55–85 | Includes the public frontend, portal and API with one warm instance each |

## Vercel

Vercel Pro is currently approximately **$20 per month**. This includes one deploying seat and infrastructure credit. Both repository projects can be hosted within the same Vercel team, so the base fee is not charged separately for the public and portal projects.

Estimated cost:

- One deploying developer: approximately **$20 per month**
- Two deploying developers: approximately **$40 per month**
- Normal early-stage traffic should remain within the included usage

Vercel Hobby is free, but its terms restrict it to personal, non-commercial use. It should only be used for owner-operated development with synthetic data.

References:

- [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Current repository deployment runbook](../specs/firebase-vercel-runbook.md)

## Firebase Hosting with Cloud Run

The lowest-cost credible alternative would be:

- Public site hosted by Firebase Hosting
- Private portal routed through Firebase Hosting to a scale-to-zero Cloud Run gateway in London
- Existing Firebase Functions and API retained

Firebase Hosting includes 10 GB per month of data transfer and 10 GB of hosting storage. At the assumed traffic level, the public frontend should therefore cost approximately **$0 per month**.

The private portal gateway could remain within the Cloud Run free allowance or cost only a few dollars at low traffic when configured to scale to zero. Firebase Hosting supports rewrites to Cloud Run in London (`europe-west2`).

This option would require adapting the deployment configuration, protected-page gateway, rewrites, headers and CI pipeline. All authentication, role, tenant, session-expiry and anonymous-page rejection tests would then need to be repeated.

References:

- [Firebase Hosting quotas and pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing)
- [Firebase Hosting and Cloud Run integration](https://firebase.google.com/docs/hosting/cloud-run)

## Cloudflare Pages with Workers

Cloudflare Workers Paid currently starts at approximately **$5 per month**, with static asset requests free and no separate bandwidth charge. This makes it attractive for the public frontend.

Using it for the private portal would require rewriting the existing Vercel page gate as a Worker-compatible implementation. Cloudflare also states that Workers code and secrets are deployed globally even when regional execution controls are enabled. Stronger data-localisation controls can require an Enterprise agreement with custom pricing.

For this project, Cloudflare is therefore most attractive for the public site rather than the authenticated hub.

References:

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers data localisation](https://developers.cloudflare.com/data-localization/how-to/workers/)

## Netlify

Netlify Pro currently starts at approximately **$20 per month** and uses a credit-based allowance for deployments, compute, bandwidth and requests.

Its cost is broadly comparable with Vercel, but the existing Vercel page gate and routing configuration would need to be migrated. There is no clear cost or architectural advantage for this repository.

Reference:

- [Netlify pricing](https://www.netlify.com/pricing/)

## AWS Amplify

AWS Amplify can be inexpensive for a small public site. It includes allowances for build minutes, storage, data transfer and server-rendered requests. AWS WAF adds at least approximately **$15 per month per Amplify application**, plus applicable WAF usage charges.

Moving the private hub to AWS would introduce another cloud provider and require a new server-side authentication gateway while the rest of the application remains on Firebase and Google Cloud. The additional engineering and operational cost outweighs the small hosting saving unless the wider platform is being standardised on AWS.

Reference:

- [AWS Amplify pricing](https://aws.amazon.com/amplify/pricing/)

## Full Google Cloud topology

The repository contains a deferred Google Cloud production topology using:

- Separate public, portal and API Cloud Run services
- London `europe-west2` deployment
- An external HTTPS load balancer
- Cloud Armor hostname restrictions and rate limiting
- Cloud CDN for public assets only
- Dedicated service identities, logging and monitoring

The Terraform configuration currently defaults to one minimum instance for each Cloud Run service. The warm instances, load balancer and Cloud Armor create a baseline cost even at low traffic.

Estimated cost:

- Frontend and edge infrastructure: approximately **$40–60 per month**
- Complete checked-in topology, including the API: approximately **$55–85 per month**

References:

- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud Armor pricing](https://cloud.google.com/armor/pricing)
- [Repository Terraform configuration](../infra/terraform/main.tf)
- [Cloud Run scaling defaults](../infra/terraform/variables.tf)

## Recommendation

Use **Vercel Pro** for both the public frontend and private hub for the near term.

At approximately **$20 per month**, its premium over the cheapest Firebase or Cloudflare configuration is smaller than the engineering and security-validation cost of migrating the authenticated hub. The repository already implements the required two-project deployment, London page-gate function, protected HTML handling, same-origin API rewrites and security headers.

Consider moving both frontends to the full Google Cloud topology later when contractual requirements, operational control or traffic justify the higher baseline cost.

The private hub must retain the following properties on any platform:

- Server-side authentication before protected HTML is returned
- Exact host and surface checks
- Tenant- and role-aware API authorization
- MFA and session-expiry enforcement
- `Cache-Control: private, no-store` for protected responses
- No patient, prescription or tenant data in public static bundles, URLs, analytics or logs
