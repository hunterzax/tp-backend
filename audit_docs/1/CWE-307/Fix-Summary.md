# CWE-307: Fix Summary

- Enabled global rate limiting (`ThrottlerModule` + global `ThrottlerGuard`).
- Added per-route throttling `@Throttle(5, 60)` to `POST /auth/login`.
- Implemented basic account lockout in `AuthService` (10 failed attempts → 15 minutes lockout; reset on success).

## Follow-ups
- Migrate failed-attempt tracking to a distributed cache (e.g., Redis) for multi-instance deployments.
- Consider gateway/WAF IP-based rate limiting and bot detection.
