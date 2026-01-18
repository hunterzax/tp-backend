# CWE-693: Fix Summary

- Added global security headers via Helmet; HSTS enabled in production.
- Hardened CORS: reject `null` origin; strict allowlist enforced from `ALLOWED_ORIGINS`.
- Enabled global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and transformation.
- Implemented global rate limiting using `@nestjs/throttler` (ttl 60s, limit 100).
- Updated dependencies: `helmet`, `@nestjs/throttler`.

## Changed Files
- `src/main.ts`
- `src/app.module.ts`
- `package.json`

## Operational Notes
- Ensure `ALLOWED_ORIGINS` is curated for each environment.
- Install new deps and rebuild: `npm install && npm run build`.
- Fine-tune throttling per-route as needed using decorators.
