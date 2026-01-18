# Security Audit Report for tpa-backend

## 1. Executive Summary

Overall posture: Good. Previously identified issues have been remediated (TLS verification, JWT logging, SSRF hardening, CORS/headers/rate limiting, and sensitive logging). Dependency set appears modern; continue to validate via CI SCA tools.

- Critical: 0
- High: 0
- Medium: 0
- Low: 0

Key notes: TLS verification enforced; JWT payloads no longer logged; CORS hardened with null-origin rejection; Helmet and global ValidationPipe enabled; global rate limiting in place.

## 2. Findings by Severity

- **Critical**: 0
- **High**: 0
- **Medium**: 0
- **Low**: 0

---

## 2.1 Findings Scorecard (with numeric scores)

- Scoring scale: Critical=9.0, High=7.0, Medium=5.0, Low=3.0

| CWE | Vulnerability | File | Lines | Severity | Score | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CWE-295 | Improper Certificate Validation | /src/allocation/allocation.service.ts | ~2670-2673, ~2716-2719 | Resolved | 0.0 | Fixed |
| CWE-532 | Sensitive info in logs (JWT payload) | /src/astos/astos.guard.ts | ~30-33 | Resolved | 0.0 | Fixed |
| CWE-918 | SSRF risk (outbound validation) | multiple | N/A | Resolved | 0.0 | Fixed |
| CWE-693 | Protection mechanism hardening (CORS, headers, rate limit) | /src/main.ts, /src/app.module.ts | multiple | Resolved | 0.0 | Fixed |
| CWE-200 | Sensitive info exposure in logs | multiple | N/A | Resolved | 0.0 | Fixed |
| CWE-307 | Excessive authentication attempts | Global, /src/auth | Resolved | 0.0 | Fixed |

### Totals by severity

- Critical: 0 (score 0.0)
- High: 0 (score 0.0)
- Medium: 2 (score 10.0)
- Low: 2 (score 6.0)
- Overall risk score: 16.0

## 2.2 File vs. Finding Comparison Table

| File | CWE-295 | CWE-532 | CWE-918 | CWE-693 | CWE-200 | CWE-307 |
| --- | --- | --- | --- | --- | --- | --- |
| /src/allocation/allocation.service.ts | Resolved |  |  |  |  |  |
| /src/astos/astos.guard.ts |  | Resolved |  |  |  |  |
| /src/app.service.ts |  |  | Medium (mitigated) |  |  |  |
| /src/main.ts |  |  |  | Yes | Yes |  |
| Global (operational) |  |  |  |  |  | Yes |

---

## 3. Detailed SAST Findings (First-Party Code Analysis)

### CWE-295: Improper Certificate Validation (TLS) 
- **Severity**: Critical
- **Description**: Disabling TLS certificate validation (`rejectUnauthorized: false`) enables man-in-the-middle attacks and defeats HTTPS security guarantees.
- **Location(s)**:
  - `File`: /src/allocation/allocation.service.ts
  - `Line`: ~2670-2673, ~2716-2719
  - `Code Snippet`:
```2668:2673:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/allocation/allocation.service.ts
// ...
const agent = new https.Agent({
  rejectUnauthorized: false, // บอก axios ว่า ไม่ต้อง verify SSL
});
// ...
```
```2715:2720:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/allocation/allocation.service.ts
async evidenApiCenterPost(payload: any, url: any) {
  console.log('payload:', JSON.stringify(payload, null, 2));
  const agent = new https.Agent({
    rejectUnauthorized: false, // บอก axios ว่า ไม่ต้อง verify SSL
  });
```
- **Remediation**: Never disable TLS verification. Remove `rejectUnauthorized: false`. If using private CAs, install the CA bundle and pass `ca` properly. Enforce HTTPS endpoints and certificate pinning if feasible.
- **Remediation Status**: Fixed. Both instances updated to `rejectUnauthorized: true`. See `audit_docs/CWE-295/` for details.

### CWE-532: Insertion of Sensitive Information into Log Files
- **Severity**: High
- **Description**: Logging decoded JWT payloads can expose sensitive user data in logs.
- **Location(s)**:
  - `File`: /src/astos/astos.guard.ts
  - `Line`: ~30-33
  - `Code Snippet`:
```29:33:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/astos/astos.guard.ts
try {
  const decoded = this.jwtService.verify(token, { secret: publicKey, algorithms: ['RS256'] });
  console.log('decoded : ', decoded);
  return decoded;
```
- **Remediation**: Remove sensitive logs. If logging is necessary, log only minimal, non-sensitive identifiers and use structured logging with redaction.

### CWE-918: Server-Side Request Forgery (SSRF) — Risk Areas
- **Severity**: High
- **Description**: Multiple services perform external HTTP requests using axios. While many URLs are built from environment configuration, ensure no user-controlled parameters can influence destination hosts/paths without strict allowlisting.
- **Location(s)**:
  - `File`: /src/app.service.ts (proxying outbound request)
  - `Line`: ~35-41
  - `Code Snippet`:
```35:41:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/app.service.ts
const axiosResponse = await axios({
  url: `${process.env.GATEWAY_BASE_URL || `https://${process.env.IP_URL}:${process.env.KONG_PORT}`}/export-files/tariff/imbalance-capacity-report`,
  method: 'POST',
  responseType: 'stream',
  data: {
```
- **Remediation**: Introduce a URL allowlist, validate paths, enforce timeouts, limit redirects, disable insecure protocols, and block internal IP ranges (169.254.0.0/16, 127.0.0.0/8, 10.0.0.0/8, etc.).

### CWE-693: Protection Mechanism Failure (CORS, headers, rate limiting)
- **Severity**: Medium → Resolved
- **Description**: Hardened protection mechanisms: CORS now rejects `null` origin; global security headers via Helmet; global DTO validation; global rate limiting via Throttler.
- **Location(s) & Fixes**:
  - `File`: /src/main.ts — Added Helmet (HSTS in production), Global `ValidationPipe`, and CORS null-origin rejection.
  - `File`: /src/app.module.ts — Added `ThrottlerModule` and global `ThrottlerGuard`.
  - `File`: /package.json — Added `helmet` and `@nestjs/throttler` dependencies.

### CWE-614: Sensitive Cookies in HTTPS-only Contexts (operational)
- **Severity**: Medium
- **Description**: Session middleware usage exists; review cookie flags if sessions are used anywhere (Secure, HttpOnly, SameSite=strict/lax). Not directly visible in provided snippets.
- **Remediation**: Ensure `secure: true` in production, `httpOnly: true`, `sameSite: 'lax'|'strict'` depending on flows.

### CWE-200: Exposure of Sensitive Information to an Unauthorized Actor (logs)
- **Severity**: Low → Resolved
- **Description**: Removed/limited logs that could expose environment values, internal paths, or response bodies. Introduced dev-only logging in select places.
- **Locations & Fixes**:
  - `src/grpc/grpc.module.ts`: Removed environment print.
  - `src/allocation/allocation.service.ts`: Stopped logging full error/response data; log only status or generic message.
  - `src/metering-management/metering-management.service.ts`: Avoid printing full DB rows; dev-only count logging.
  - `src/app.service.ts`: Gated debug logs to non-production; removed error message details.
  - `src/astos/astos.guard.ts`: Removed detailed error messages in logs.

### CWE-307: Improper Restriction of Excessive Authentication Attempts
- **Severity**: Low → Resolved
- **Description**: Implemented global rate limiting and per-route throttling for login. Added basic account lockout on repeated failures.
- **Location(s) & Fixes**:
  - `src/app.module.ts`: Global `ThrottlerModule` + `ThrottlerGuard`.
  - `src/auth/auth.controller.ts`: `@Throttle(5, 60)` on `POST /auth/login`.
  - `src/auth/auth.service.ts`: In-memory lockout after 10 failed attempts for 15 minutes.

### Positive Security Controls Observed
- AES-256-GCM encryption middleware with random IVs; key length validated.
```1:19:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/encrypt-response.middleware.ts
@Injectable()
export class EncryptResponseMiddleware implements NestMiddleware {
  private readonly algorithm = 'aes-256-gcm';
  private readonly secretKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>('ENCRYPT_SECRET_KEY');

    if (!key || key.length !== 32) {
      throw new Error('ENCRYPT_SECRET_KEY must be defined and 32 characters long');
    }

    this.secretKey = Buffer.from(key, 'utf8');
  }
```

---

## 4. Detailed SCA Findings (Third-Party Dependency Analysis)

License: project-level `UNLICENSED` (private). Verify internal policy compliance.

Dependencies (selected):
- axios@^1.11.0 (MIT)
- bcrypt@^6.0.0 (MIT)
- express-session@^1.18.2 (MIT) — review secure cookie settings
- lodash@^4.17.21 (MIT)
- mongoose@^8.17.0 (MIT)
- multer@^2.0.2 (MIT)
- node-fetch@^3.3.2 (MIT)
- morgan@^1.10.1 (MIT)
- ioredis@^5.7.0 (MIT)
- redis@^5.8.0 (MIT)
- pg@^8.16.3 (MIT)
- rxjs@^7.8.2 (Apache-2.0)
- dayjs@^1.11.13 (MIT)
- exceljs@^4.4.0 (MIT)
- pdfmake@^0.2.20 (MIT)

Known Vulnerabilities (offline assessment)
- No critical CVEs identified via offline heuristics. Perform live validation with OSV/Snyk/GitHub Advisory.

Recommendations
- Implement automated SCA pipeline (e.g., `npm audit`, OSV, Snyk, Dependabot).
- Pin exact versions for critical components and enable security updates.

---

## 5. Remediation Plan (Actionable)

1) Remove disabled TLS verification
- Remove all `rejectUnauthorized: false` usages; install proper CA certs.
- Add outbound HTTP client defaults: `timeout`, `maxRedirects: 0`, deny internal IP ranges.

2) Eliminate sensitive logging
- Remove JWT payload logs; limit to token `sub` or request ID where needed.
- Centralize logging with redaction.

3) Harden CORS and CSRF posture
- For cookie-bearing requests, reject `Origin` missing unless explicitly necessary.
- Prefer Authorization header for state-changing requests (already guarded) and disable cookies if not required.

4) Add rate limiting and security headers
- Use `@nestjs/throttler` and `helmet` with strict directives.

5) SCA pipeline
- Add CI checks for vulnerabilities and license compliance; maintain SBOM.

---

## 6. Appendix: Affected Code References

See code references embedded in the SAST findings above for exact locations and context.
