## CWE-918: Server-Side Request Forgery (SSRF) – Detailed File Analysis

Scope derived from `CWE-918: Server-Side.md` references and adjacent call-sites.

### 1) src/allocation/allocation.service.ts
- Risk points: `evidenApiCenter(...)` and `evidenApiCenterPost(...)` accepted a `url` parameter that was concatenated to `process.env.IP_EVIDEN` without validation.
- Impact: If `url` were influenced by user input, it could be abused to target internal endpoints or manipulate request paths.
- Fix: Added runtime guard using `assertSafeServicePath` to ensure only safe relative paths without protocol, host, traversal, query or fragment are allowed. On violation, the functions now return an empty array and log the reason.

### 2) src/balancing/balancing.service.ts
- Risk points: `evidenApiCenter(...)` accepted a `url` parameter concatenated to `process.env.IP_EVIDEN` without validation.
- Impact: Same SSRF risk as above.
- Fix: Added `assertSafeServicePath` check before building the request URL; returns `[]` on invalid path.

### 3) src/account-manage/account-manage.service.ts
- Reference lines target `convertUrlToBase64(...)` which fetches a user-provided URL via internal file service.
- Status: Already validates user URL by calling `assertSafeExternalUrl` in `src/common/utils/url.util.ts`. No changes needed.

### 4) src/event/event.service.ts
- Reference lines target `convertUrlToBase64(...)` similar to account-manage path.
- Status: Calls `assertSafeExternalUrl` before forwarding. No changes needed.

### 5) src/common/utils/url.util.ts
- Enhancement: Introduced `assertSafeServicePath(path: string)` to harden all internal service calls that accept a relative path segment. Existing `assertSafeExternalUrl` already mitigates direct external URL SSRF.

### 6) src/common/utils/inapp.util.ts
- Status: Uses `IN_APP_URL` from env; protocol is validated to http/https via `new URL(...)`. No user-controlled parts; safe.

### 7) src/astos/astos.service.ts
- Status: Notifications use `IN_APP_URL` with protocol validation. Safe.

### 8) src/parameter/config-mode-zone-base-inventory.ts
- Status: Calls out to `METER_WEBSERVICE`; protocol is validated to http/https before requests. Safe.

### 9) src/asset/metering-point.ts
- Status: Calls out to `METER_WEBSERVICE`; protocol is validated to http/https before requests. Safe.

### 10) src/use-it-or-lose-it/use-it-or-lose-it.service.ts
- Status: Uses fixed paths on `IP_EVIDEN` with HTTPS agent; no user-controlled path segments. Safe.

### 11) src/common/utils/uploadFileIn.ts
- Status: Uploads to gateway using `IP_URL` and `KONG_PORT`. No user-controlled destination. Safe.

### 12) scripts/fetch-env-from-vault.js
- Status: Validates `VAULT_ADDR` with URL parsing and restricts to http/https. No SSRF vector. Safe.

### 13) src/tariff/tariff.service.ts
- Status: In-app notifications use `IN_APP_URL` with protocol validation. Safe.

### 14) src/balancing/balancing.service.ts (token note)
- Observation: Contains a fallback hard-coded token for `TOKEN_EVIDEN`. Not SSRF, but a separate CWE-798 concern. Not changed in this task.

## Conclusion
All user-influenced external URL fetches are guarded by `assertSafeExternalUrl`. All internal service calls that accept a dynamic relative path now validate via `assertSafeServicePath`. No remaining SSRF vectors were found in referenced locations.

### 15) src/astos/astos.guard.ts
- Risk points: Public key retrieval used an environment/configured URL without explicit SSRF validation.
- Fix: Added `assertSafeExternalUrl(url)` and axios safety options (`timeout`, limited `maxRedirects`).

### 16) src/app.service.ts
- Risk points: Destination base URL composed from environment could be misconfigured to a non-http(s) scheme.
- Fix: Added validation using `tryParseUrl` to ensure `GATEWAY_BASE_URL` (or the constructed default) uses http/https; throws on invalid.


