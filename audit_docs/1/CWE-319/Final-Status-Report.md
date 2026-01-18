Title: CWE-319 Cleartext Transmission - Final Status Report

Status: Remediated

Summary
- All detected cleartext internal HTTP calls were replaced with HTTPS using a configurable `GATEWAY_BASE_URL` fallback to `https://${IP_URL}:${KONG_PORT}`.
- TLS verification was enforced across services by removing/overriding `rejectUnauthorized: false` usages.
- SMTP transport now validates certificates by default; insecure mode is only permitted in non-production when explicitly configured.

Files Changed
- src/common/utils/uploadFileIn.ts
- src/event/event.service.ts
- src/account-manage/account-manage.service.ts
- src/astos/astos.guard.ts
- src/balancing/balancing.service.ts
- src/allocation/allocation.service.ts
- src/use-it-or-lose-it/use-it-or-lose-it.service.ts
- src/app.service.ts

Residual Risk
- CORS allows some http:// client origins (browser-side). This does not directly create server-to-server cleartext transmission but should be reviewed by frontend/platform teams for HSTS and HTTPS-only enforcement.

Validation Checklist
- Build compiles without errors.
- Environment variables present in deployment config.
- Upstream services accessible via HTTPS with valid certificate chains.

