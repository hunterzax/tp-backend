Title: CWE-319 Cleartext Transmission - Fix Summary

Updated Files
- src/common/utils/uploadFileIn.ts: Switch upload endpoint to HTTPS or `GATEWAY_BASE_URL`.
- src/event/event.service.ts: Switch convert-to-base64 to HTTPS/`GATEWAY_BASE_URL`; enforce SMTP TLS verification (env override allowed only outside production).
- src/account-manage/account-manage.service.ts: Switch convert-to-base64 to HTTPS/`GATEWAY_BASE_URL`.
- src/astos/astos.guard.ts: Default public-key URL to HTTPS.
- src/balancing/balancing.service.ts: Enforce TLS certificate verification.
- src/allocation/allocation.service.ts: Enforce TLS certificate verification.
- src/use-it-or-lose-it/use-it-or-lose-it.service.ts: Enforce TLS certificate verification.
- src/app.service.ts: Parameterize and switch export endpoint to HTTPS/`GATEWAY_BASE_URL`.

Environment Variables Introduced
- GATEWAY_BASE_URL: Optional; full base URL like `https://gateway.example.com:443`.
- SMTP_REJECT_UNAUTHORIZED: Optional; if set to `false` and `NODE_ENV` is not `production`, TLS verification may be disabled for SMTP only.

Operational Notes
- Ensure valid certificates are installed for all upstreams. Self-signed certs should be replaced or chain-trusted.
- Review client origins in `src/main.ts` CORS for production security policy; not required for this CWE but recommended.

