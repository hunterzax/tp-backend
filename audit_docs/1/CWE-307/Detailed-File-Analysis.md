# CWE-307: Improper Restriction of Excessive Authentication Attempts — Detailed File Analysis

## Controls Added

1) Global rate limiting
- File: `src/app.module.ts`
- Change: Added `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` and global `ThrottlerGuard`.

2) Per-route throttling for login
- File: `src/auth/auth.controller.ts`
- Change: Added `@Throttle(5, 60)` on `POST /auth/login`.

3) Account lockout on repeated failures
- File: `src/auth/auth.service.ts`
- Change: Added in-memory failed-attempt tracking per username; lockout after 10 failures for 15 minutes; reset on success.

## Code References (after)

```30:38:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/auth/auth.controller.ts
@Post('login')
@Throttle(5, 60)
async signIn(@Res() res, @Body() signInDto: Record<string, any>) {
```

```11:24:/Users/zax/Documents/Project_TPA_SCAN/VA146/nestjs-master-back-end/src/auth/auth.service.ts
private failedAttempts: Map<string, { count: number; lockUntil: number }> = new Map();
...
if (state && state.lockUntil && state.lockUntil > now) {
  throw new UnauthorizedException();
}
...
if (!isMatch) {
  this.registerFailure(username);
  throw new UnauthorizedException();
}
this.failedAttempts.delete(username);
```

## Residual Risks
- In-memory lockout does not persist across restarts and is per-instance; consider using shared cache (Redis) for distributed deployments.
- Consider per-IP rate limits on login endpoints at the gateway/WAF layer.

## Testing Notes
- Repeated wrong-password attempts return 401 and, after threshold, remain locked for 15 minutes.
- Login requests rate-limited to 5/min per client by guard.
