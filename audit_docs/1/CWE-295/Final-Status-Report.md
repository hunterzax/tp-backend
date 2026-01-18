# CWE-295 Final Status Report

Date: 2025-10-30
Status: Resolved (Production-safe)

## Overview
CWE-295 (Improper Certificate Validation) instances were identified and remediated. All server-side HTTPS clients now enforce certificate validation. No global overrides that disable TLS verification were found.

## Resolved Items
- `src/allocation/allocation.service.ts`
  - Two occurrences of `rejectUnauthorized: false` replaced with `rejectUnauthorized: true`.

## Non-issues / Acceptable Configurations
- `src/balancing/balancing.service.ts`: TLS verification enforced.
- `src/use-it-or-lose-it/use-it-or-lose-it.service.ts`: TLS verification enforced.
- `src/event/event.service.ts`: Development-only toggle for SMTP TLS verification remains but is disabled in production by guard `NODE_ENV !== 'production'`.

## Repository-wide Checks
- `NODE_TLS_REJECT_UNAUTHORIZED=0`: Not present.
- Any `rejectUnauthorized: false` usage: eliminated from runtime code paths, except guarded SMTP path only in non-prod.

## Residual Risk and Recommendations
- If internal endpoints use private CA, provide CA bundle via environment (e.g., `CA_CERT_PATH`) and configure `https.Agent({ ca })` rather than disabling verification.
- Monitor configuration drift during deployments to ensure production always enforces TLS verification.
