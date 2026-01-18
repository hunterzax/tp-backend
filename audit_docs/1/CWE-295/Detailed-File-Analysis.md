# CWE-295 Improper Certificate Validation - Detailed File Analysis

Scope: Backend service (NestJS) under `src/`
Date: 2025-10-30

## Findings and Analysis

- **src/allocation/allocation.service.ts**
  - Issue A: `https.Agent({ rejectUnauthorized: false })` used in `evidenApiCenter`
  - Issue B: `https.Agent({ rejectUnauthorized: false })` used in `evidenApiCenterPost`
  - Risk: Disables TLS certificate verification; susceptible to MITM attacks.
  - Before (references):
```2667:2673:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/allocation/allocation.service.ts
async evidenApiCenter(payload: any, url: any) {
  const agent = new https.Agent({
    rejectUnauthorized: false,
  });
```
```2715:2720:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/allocation/allocation.service.ts
async evidenApiCenterPost(payload: any, url: any) {
  const agent = new https.Agent({
    rejectUnauthorized: false,
  });
```
  - After (fixed): Both replaced with `rejectUnauthorized: true`.

- **src/balancing/balancing.service.ts**
  - Observation: `https.Agent` present; TLS verification is enforced.
  - Evidence:
```85:86:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/balancing/balancing.service.ts
const agent = new https.Agent({
  rejectUnauthorized: true,
});
```
```8561:8563:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/balancing/balancing.service.ts
// Mailer/transport options
 tls: { rejectUnauthorized: true },
```
  - Status: No change required.

- **src/use-it-or-lose-it/use-it-or-lose-it.service.ts**
  - Observation: `https.Agent({ rejectUnauthorized: true })` is used for external requests.
  - Evidence:
```994:1000:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/use-it-or-lose-it/use-it-or-lose-it.service.ts
const agent = new https.Agent({
  rejectUnauthorized: true,
});
```
  - Status: No change required.

- **src/event/event.service.ts**
  - Observation: SMTP TLS verification is conditionally disabled only in non-production when `SMTP_REJECT_UNAUTHORIZED=false`.
  - Evidence:
```2184:2184:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/event/event.service.ts
 tls: process.env.SMTP_REJECT_UNAUTHORIZED === 'false' && process.env.NODE_ENV !== 'production' ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
```
  - Assessment: Acceptable for development if strictly guarded by `NODE_ENV !== 'production'`. No production risk.
  - Status: No change required.

## Repository-wide Checks
- `NODE_TLS_REJECT_UNAUTHORIZED=0`: Not found.
- `rejectUnauthorized: false`: Fixed in `allocation.service.ts`; no other occurrences remain except the guarded SMTP case above.
- `httpsAgent` usage: Verified at call sites; agents now enforce TLS.

## Recommendations
- If private/internal CAs are required, install the CA bundle on the host or pass it via `https.Agent({ ca: fs.readFileSync(process.env.CA_CERT_PATH) })` instead of disabling verification.
- Ensure all service endpoints use HTTPS and valid certificates.
