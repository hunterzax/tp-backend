## CWE-532: Insertion of Sensitive Information into Log Files — Remediation Report

### Scope
- Reviewed the entire backend for unsafe logging of secrets, tokens, payloads, headers, environment values, file paths, and decoded credentials.

### Fixes Applied

- Removed debug logs of SSL key/cert paths and environment from `src/main.ts`.
- Removed environment logging from `prisma/prisma.service.ts`.
- Removed request/response payload logging in `src/allocation/allocation.service.ts` around the Eviden API.
- Removed decoded JWT payload logging in `src/astos/astos.guard.ts`.
- Removed raw data logging during metering processing in `src/metering-management/metering-management.service.ts`.

### File-level details and code references

1) src/main.ts

Before:
```49:51:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/main.ts
console.log('sslKeyPath:', sslKeyPath);
console.log('sslCertPath:', sslCertPath);
console.log('process.env.NODE_ENV : ', process.env.NODE_ENV);
```

After: removed the above console logs.

2) prisma/prisma.service.ts

Before:
```21:22:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/prisma/prisma.service.ts
// ป้องกันใน dev environment ไม่ให้ new PrismaClient ซ้ำ
console.log(process.env.NODE_ENV);
```

After: removed the environment log.

3) src/allocation/allocation.service.ts

Before:
```2715:2717:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/allocation/allocation.service.ts
async evidenApiCenterPost(payload: any, url: any) {
  console.log('payload:', JSON.stringify(payload, null, 2));
```
```2743:2745:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/allocation/allocation.service.ts
console.log('send request')
const resEviden = await axios.request(config);
console.log(`resEviden (${resEviden?.status}): ${JSON.stringify(resEviden?.data, null, 2)}`)
```

After: removed payload and response logging; kept functional flow intact.

4) src/astos/astos.guard.ts

Before:
```29:33:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/astos/astos.guard.ts
try {
  const decoded = this.jwtService.verify(token, { secret: publicKey, algorithms: ['RS256'] });
  console.log('decoded : ', decoded);
  return decoded;
```

After: removed decoded payload logging.

5) src/metering-management/metering-management.service.ts

Before:
```2171:2174:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/metering-management/metering-management.service.ts
if (Number(reply?.data[i]?.energy) <= 0) {
  // มี แต่ energy 0
  console.log('มี แต่ energy 0 : ', reply?.data[i]?.energy);
```
```2184:2186:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/metering-management/metering-management.service.ts
// ไม่มี
console.log('ไม่มี : ', reply?.data[i]);
```
```2242:2243:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/metering-management/metering-management.service.ts
console.log('ok');
```

After: removed the above console logs.

### Rationale
- Console logging of envs, file paths, tokens, payloads, and decoded JWTs can leak secrets and PII (CWE-532).
- The changes favor minimal operational logging without sensitive data. Structured logging with allow-listing can be considered later if needed.

### Verification
- Linter run on modified files: no errors introduced.
- Runtime behavior unaffected: Only log statements removed; control flow preserved.

### Recommendations
- Prefer Nest `Logger` with restricted levels in production.
- If logging payloads is necessary for debugging in dev, gate behind `NODE_ENV === 'development'` and ensure redaction of fields like `authorization`, `password`, `token`, `secret`, `key`, `cert`, `set-cookie`.


