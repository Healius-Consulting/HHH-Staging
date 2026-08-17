# Vercel Deployment & Domain Aliasing Guidelines

## Core Invariant: Always Alias Custom Domains Post-Deployment

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
