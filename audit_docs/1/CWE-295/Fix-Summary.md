# CWE-295 Fix Summary

Date: 2025-10-30

## Summary of Changes
- Enforced TLS certificate validation across HTTP clients where previously disabled.
- Verified no global overrides such as `NODE_TLS_REJECT_UNAUTHORIZED=0` remain.

## File-level Fixes
- `src/allocation/allocation.service.ts`
  - Changed two instances of `https.Agent({ rejectUnauthorized: false })` to `rejectUnauthorized: true` in:
    - `evidenApiCenter`
    - `evidenApiCenterPost`

## Verified Secure Configurations (no code change needed)
- `src/balancing/balancing.service.ts`
  - Uses `https.Agent({ rejectUnauthorized: true })` and `tls: { rejectUnauthorized: true }`.
- `src/use-it-or-lose-it/use-it-or-lose-it.service.ts`
  - Uses `https.Agent({ rejectUnauthorized: true })`.
- `src/event/event.service.ts`
  - Conditional: allows `rejectUnauthorized: false` only in non-production when `SMTP_REJECT_UNAUTHORIZED=false`. Production always enforces TLS verification.

## Recommendations
- For internal CAs, configure CA bundle via environment (`CA_CERT_PATH`) and supply to `https.Agent({ ca: ... })`.
- Keep production environments with strict TLS; avoid disabling verification even for testing endpoints.
