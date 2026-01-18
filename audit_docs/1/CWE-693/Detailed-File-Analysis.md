# CWE-693: Protection Mechanism Failure — Detailed File Analysis

Scope: CORS policy, security headers, rate limiting, and input validation across the NestJS application.

## Affected Files and Findings

1) src/main.ts
- Before: CORS allowlist existed but allowed `null` origins implicitly; no Helmet security headers; no global `ValidationPipe`.
- After: Added Helmet (with HSTS in production), global DTO validation, and explicit rejection for `Origin: null`.

2) src/app.module.ts
- Before: No global rate limiting.
- After: Added `ThrottlerModule` (ttl=60s, limit=100) and global `ThrottlerGuard`.

3) package.json
- Added dependencies: `helmet@^7.1.0`, `@nestjs/throttler@^6.2.0` for runtime protection mechanisms.

## Code References (after)

```80:123:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/main.ts
app.enableCors({
  origin: (origin, callback) => {
    const raw = process.env.ALLOWED_ORIGINS || '';
    const allow = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!origin) return callback(null, true);
    if (origin === 'null') return callback(new Error('CORS null origin not allowed'), false);
    if (allow.includes(origin)) return callback(null, true);
    return callback(new Error('CORS not allowed'), false);
  },
  credentials: true,
});

app.use(helmet({
  contentSecurityPolicy: false,
  xPoweredBy: false,
}));
if (process.env.NODE_ENV === 'production') {
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true, preload: false }));
}

app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}));
```

```58:74:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/app.module.ts
imports: [
  ThrottlerModule.forRoot([
    {
      ttl: 60_000,
      limit: 100,
    },
  ]),
  // ...
],
providers: [
  AppService,
  { provide: APP_GUARD, useClass: ThrottlerGuard },
],
```

## Residual Risks
- Helmet CSP disabled to avoid breaking API clients; enable CSP on HTML routes if any UI is served.
- If cookie-based auth is introduced, revisit strict `Origin` handling for state-changing requests.
- Per-route throttling can be tuned with decorators; current global defaults are safe starting points.

## Testing Notes
- Verified CORS origin rejection for `null` and non-allowlisted origins.
- Verified security headers present on responses.
- DTO validation rejects extra properties and coerces types safely.

