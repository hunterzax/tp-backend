## CWE-918 Final Status Report

### Overview
Server-Side Request Forgery (SSRF) risks were assessed across referenced files. Key changes ensure that any dynamic external URL is validated and that internal service-path parameters are constrained to safe relative paths.

### Remediation Summary
- Implemented `assertSafeServicePath` in `src/common/utils/url.util.ts`.
- Enforced path validation at:
  - `src/allocation/allocation.service.ts`: `evidenApiCenter`, `evidenApiCenterPost`.
  - `src/balancing/balancing.service.ts`: `evidenApiCenter`.
- Validated configured external endpoints and tightened client options at:
  - `src/astos/astos.guard.ts`: `getPublicKey` now uses `assertSafeExternalUrl`, timeout, and limited redirects.
  - `src/app.service.ts`: validates `GATEWAY_BASE_URL` (or constructed default) to enforce http/https.
- Confirmed external URL validation (`assertSafeExternalUrl`) is used before fetching user-provided URLs in:
  - `src/account-manage/account-manage.service.ts`
  - `src/event/event.service.ts`
- Confirmed environment-configured base URLs are validated to http/https in:
  - `src/common/utils/inapp.util.ts`, `src/astos/astos.service.ts`, `src/tariff/tariff.service.ts`
  - `src/parameter/config-mode-zone-base-inventory.ts`, `src/asset/metering-point.ts`
  - `scripts/fetch-env-from-vault.js`

### Risk Status
- Residual SSRF risk: Low. User-controlled URLs are validated; internal service paths are constrained to safe relative paths; configured endpoints are protocol-validated.
- Non-SSRF note: A hard-coded token fallback remains in `src/balancing/balancing.service.ts`. Recommend removal as part of CWE-798 remediation.

### Verification
- Code reviewed at all flagged line numbers from `CWE-918: Server-Side.md`.
- All edits compile cleanly and do not alter existing request semantics, except to reject/skip unsafe paths.

### Next Steps (Recommendations)
- Add unit tests for `assertSafeServicePath` and call sites with valid/invalid paths.
- Consider centralizing outbound HTTP client creation with built-in validators.
- Set global axios defaults to restrict SSRF impact (timeout, redirect limits) — added in `src/main.ts` (10s timeout, maxRedirects=3).
- Address hard-coded token fallback (CWE-798) separately.


