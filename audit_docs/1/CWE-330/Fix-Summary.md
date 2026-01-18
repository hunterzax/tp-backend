# CWE-330 Fix Summary

Objective: Replace all insecure randomness (`Math.random` and guessable IDs) with cryptographically secure alternatives.

## Changes by File

- src/balancing/balancing.service.ts
  - Use `crypto.randomInt(0, 16777215)` to generate color values.

- src/export-files/export-files.service.ts
  - Replace custom ID generator with `crypto.randomUUID()`.

- src/export-files/export-file-tariff-commodity.service.ts
  - Add `crypto` import and `jitter(range)` using `crypto.randomInt`.
  - Replace all `Math.random()`-based jitter in sample data.

- src/auth/auth.service.ts
  - Use `crypto.randomInt` for password character index selection.

- src/common/utils/account.util.ts
  - Add `crypto` import.
  - Replace all index selections and `shuffle` logic with `crypto.randomInt`.

## Rationale
- `Math.random()` is not suitable for security-sensitive contexts (CWE-330).
- Node's `crypto` module provides CSPRNG via `randomInt`, `randomBytes`, and `randomUUID`.

## Validation
- Lint: No errors on modified files.
- Functional behavior unchanged aside from improved randomness.
- No runtime configuration changes required.
