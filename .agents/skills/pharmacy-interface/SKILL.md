---
name: pharmacy-interface
description: Design and review authenticated pharmacy workspace interfaces while preserving fail-closed authentication, tenant identity, privacy, accessibility, and the repository design system. Use for Pharmacy Overview work, new pharmacy screens, layout or responsive changes, UI state mapping, design-system components, visual audits, and refinements to existing pharmacy views. Do not use for public marketing or admin surfaces except to identify and preserve their deployment boundary.
---

# Pharmacy Interface

## Required workflow

1. Read [`../../../docs/design/pharmacy-surface-register.md`](../../../docs/design/pharmacy-surface-register.md) completely before inspecting or editing a screen. Treat every Fixed and Forbidden rule as a hard constraint.
2. Identify the current surface and build artefact. Pharmacy work belongs in `apps/pharmacy` and shared non-sensitive primitives in `packages/ui`; never pull admin or public flows into the pharmacy bundle.
3. Inventory every displayed field and state before composing layout. For each item, capture audience, classification, API source, fixed/flexible status, interaction, audit need, and loading/empty/error/stale/offline/permission behaviour.
4. Confirm the server contract returns the minimum necessary fields. Do not calculate Overview aggregates by loading patient/order collections, and never treat client state as authoritative for tenant, clinical, or payment actions.
5. Establish hierarchy and responsive behaviour first. Produce or inspect at least desktop and 360px mobile views; include tablet when the composition changes materially.
6. Use the shared tokens and primitives. Preserve `SecureAppShell`, workspace identity, live/training/paused state, staff/session controls, tenant-aware navigation, focus styles, status meanings, and audit-backed action outcomes.
7. Implement all non-happy states alongside the main view. Status must have text or an accessible name in addition to colour.
8. Review privacy, keyboard order, visible and unobscured focus, screen-reader names and announcements, 200% zoom, 44px targets, responsive overflow, dark/light themes, and reduced motion.
9. Only after layout and state behaviour are stable, use the repository motion skills for restrained micro-interactions. Motion must not communicate unique information and must honour reduced-motion preferences.
10. Verify the relevant build, tests, and visual states. Report any missing API contract or security decision instead of bypassing it in the client.

## Immutable elements

- Authenticated shell and server-verified access before protected HTML.
- Current pharmacy identity, staff identity and role, tenant-aware navigation, session expiry, and sign-out.
- Live, training, onboarding, paused, degraded, and unavailable meanings.
- Backend-authorised record opening and backend-only mutations.
- WCAG 2.2 AA focus, authentication, target, status, and navigation behaviour.

## Flexible elements

Card order, density, grid/list/board composition, metric emphasis, view switching, token-approved type hierarchy, spacing, borders, surface depth, icons, and restrained motion may change when the inventory and state map support the decision.

## Privacy and action rules

- Mask patient identity in Daily Operations; show aggregate or case-reference information in Pipeline; show zero PII in Secure Handover.
- Never put patient/contact/prescription data in URLs, storage, analytics, logs, or toast text.
- Overview actions navigate to an authorised detail context. Messaging, reminders, refunds, payment changes, and prescription actions occur only on the full record screen through audited API mutations.
- Never hide tenant context or use a runtime query parameter to switch portal, tenant, authentication, or production application.

## Completion output

Summarise the data/state inventory, fixed elements preserved, responsive views checked, accessibility/privacy findings, and verification performed. If a requested visual conflicts with a fixed rule, explain the conflict and provide a compliant alternative.
