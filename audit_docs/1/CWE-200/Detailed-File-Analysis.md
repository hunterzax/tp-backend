# CWE-200: Exposure of Sensitive Information — Detailed File Analysis

Scope: Logging of environment variables, internal paths, tokens, response bodies, database rows, and other potentially sensitive data.

## Files reviewed and changes

1) src/grpc/grpc.module.ts
- Issue: Printed `process.env.IP_URL` on module load.
- Fix: Removed the console output.

2) src/allocation/allocation.service.ts
- Issue: Logged full `error.response.data` and full error objects from upstream services.
- Fix: Log only generic messages and HTTP status; avoid body/stack exposure.

3) src/metering-management/metering-management.service.ts
- Issue: Printed entire DB result arrays to logs.
- Fix: Dev-only logging of counts; no data payloads in production.

4) src/app.service.ts
- Issue: Debug markers and detailed error messages.
- Fix: Gate debug logs behind `NODE_ENV !== 'production'`; log generic error.

5) src/astos/astos.guard.ts
- Issue: Detailed error messages during public key fetch and token verification.
- Fix: Generic error logs without message content.

## Representative code references (after)

```8:13:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/grpc/grpc.module.ts
import { ConfigModule } from '@nestjs/config';
```

```170:181:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/allocation/allocation.service.ts
} catch (error) {
  // Avoid logging full error objects that may contain sensitive data
  console.log('error during evidenApiAllocationEod');
  if (error.response) {
    console.log('Eviden API Error Status:', error.response.status);
  } else {
    console.log('Eviden API Error');
  }
  return [];
}
```

```401:406:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/metering-management/metering-management.service.ts
// Avoid logging full database records in logs
if (process.env.NODE_ENV !== 'production') {
  console.log('resData count: ', resData?.length || 0);
}
```

```32:41:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/app.service.ts
if (process.env.NODE_ENV !== 'production') console.log('---1');
...
if (process.env.NODE_ENV !== 'production') console.log('--2-');
...
console.error('Error fetching file');
```

```20:37:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/astos/astos.guard.ts
console.error('Error fetching public key');
...
console.error('Token verification failed');
```

## Residual risks and guidance
- Developers should avoid logging response bodies, headers, tokens, secrets, or user PII.
- Prefer structured logging with redaction for future enhancements.
- Keep debug logging gated by environment variables and ensure production logs are minimal.
