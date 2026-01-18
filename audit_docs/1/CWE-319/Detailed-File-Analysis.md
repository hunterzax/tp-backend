Title: CWE-319 Cleartext Transmission - Detailed File Analysis

Scope: Backend service (NestJS) under `src/`

Findings and Analysis

1) src/common/utils/uploadFileIn.ts
- Issue: HTTP used for file upload to gateway.
- Risk: Files and metadata transmitted without TLS protection.
- Before: `http://${process.env.IP_URL}:${process.env.KONG_PORT}/files/uploadfile/`
- After: Use HTTPS or `GATEWAY_BASE_URL` if provided.

2) src/event/event.service.ts
- Issue A: HTTP used for file conversion endpoint.
- Issue B: SMTP TLS verification disabled via `rejectUnauthorized: false`.
- Risk: Cleartext transmission and MITM risk on email channel.
- After A: Switched to HTTPS/`GATEWAY_BASE_URL`.
- After B: Enforce TLS verification; only allow disabling in non-production when `SMTP_REJECT_UNAUTHORIZED=false`.

3) src/account-manage/account-manage.service.ts
- Issue: HTTP used for file conversion endpoint.
- After: Switched to HTTPS/`GATEWAY_BASE_URL`.

4) src/astos/astos.guard.ts
- Issue: Public key retrieval defaulted to HTTP.
- Risk: Token verification key could be intercepted.
- After: Default to HTTPS for the discovery URL (still overridable via `ASTOS_PUBLIC_KEY_URL`).

5) src/balancing/balancing.service.ts
- Issue: Multiple `https.Agent({ rejectUnauthorized: false })` and TLS blocks disabling verification.
- Risk: TLS session vulnerable to MITM.
- After: Set `rejectUnauthorized: true` universally in this service.

6) src/allocation/allocation.service.ts
- Issue: Multiple `https.Agent({ rejectUnauthorized: false })` and TLS blocks disabling verification.
- After: Set `rejectUnauthorized: true` universally in this service.

7) src/use-it-or-lose-it/use-it-or-lose-it.service.ts
- Issue: `https.Agent({ rejectUnauthorized: false })`.
- After: Set `rejectUnauthorized: true`.

8) src/app.service.ts
- Issue: Hard-coded internal HTTP URL to export service.
- After: Parameterized and switched to HTTPS/`GATEWAY_BASE_URL`.

Notes
- CORS origins in `src/main.ts` still list some `http://` origins; these are client origins and do not directly control transport security between servers. They should be reviewed by the platform team separately if HSTS is to be enforced end-to-end.
- Commented example URLs containing http:// remain only in comments for developer reference and do not impact runtime.

