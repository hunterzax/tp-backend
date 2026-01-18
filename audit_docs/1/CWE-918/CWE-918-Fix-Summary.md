## CWE-918 Fix Summary

### New Utility
- Added `assertSafeServicePath(path: string)` in `src/common/utils/url.util.ts` to validate relative service paths:
  - Disallows absolute URLs, protocol-relative URLs, query/fragment, and `..` traversal.
  - Ensures only safe URL path characters are used.

### Updated Call Sites
- `src/allocation/allocation.service.ts`
  - `evidenApiCenter(...)`: validates `url` with `assertSafeServicePath` before building `IP_EVIDEN/{url}`.
  - `evidenApiCenterPost(...)`: same validation for POST variant.
  - Behavior on invalid path: log and return `[]` (no request sent).

- `src/balancing/balancing.service.ts`
  - `evidenApiCenter(...)`: validates `url` with `assertSafeServicePath`.
  - Behavior on invalid path: log and return `[]` (no request sent).

- `src/astos/astos.guard.ts`
  - `getPublicKey(...)`: validates configured URL with `assertSafeExternalUrl`; sets axios `timeout` and limits `maxRedirects`.

- `src/app.service.ts`
  - `demoHtml(...)`: validates base URL (`GATEWAY_BASE_URL` or default) to ensure http/https using `tryParseUrl` before request.

### Verified Safe (No Change Needed)
- `src/account-manage/account-manage.service.ts`: uses `assertSafeExternalUrl` for user URLs.
- `src/event/event.service.ts`: uses `assertSafeExternalUrl` for user URLs.
- `src/common/utils/inapp.util.ts`, `src/astos/astos.service.ts`, `src/tariff/tariff.service.ts`: validate `IN_APP_URL` protocol.
- `src/parameter/config-mode-zone-base-inventory.ts`, `src/asset/metering-point.ts`: validate `METER_WEBSERVICE` protocol.
- `src/use-it-or-lose-it/use-it-or-lose-it.service.ts`: fixed paths on `IP_EVIDEN`.
- `src/common/utils/uploadFileIn.ts`: fixed gateway destination.
- `scripts/fetch-env-from-vault.js`: validates `VAULT_ADDR` protocol.

### Notes
- One hard-coded token fallback exists in `src/balancing/balancing.service.ts` (not SSRF). Consider addressing under CWE-798 remediation.


