# CWE-330: Use of Insufficiently Random Values — Detailed File Analysis

Scope: Backend repository. All insecure randomness instances were identified and fixed.

## Files and Findings

- src/balancing/balancing.service.ts
  - Finding: Hex color generation used `Math.random()`.
  - Impact: Predictable values; CWE-330.
  - Resolution: Use `crypto.randomInt(0, 16777215)` and format to hex.

- src/export-files/export-files.service.ts
  - Finding: IDs created with `Date.now().toString(36) + Math.random().toString(36)`.
  - Impact: Guessable identifiers; CWE-330.
  - Resolution: Use `crypto.randomUUID()`.

- src/export-files/export-file-tariff-commodity.service.ts
  - Finding: Sample/jitter values used `Math.random()` in multiple places.
  - Impact: Non-crypto randomness present in code; flagged under CWE-330.
  - Resolution: Introduced `crypto.randomInt`-based jitter helper.

- src/auth/auth.service.ts
  - Finding: Password generation loop used `Math.random()` for index selection.
  - Impact: Weak password generation if used.
  - Resolution: Switch to `crypto.randomInt`.

- src/common/utils/account.util.ts
  - Findings:
    - `generatePassword`: `Math.random()` used for index selection.
    - Character-class backfill used `Math.random()`.
    - `shuffle`: Fisher–Yates index used `Math.random()`.
  - Resolution:
    - Replace all selections with `crypto.randomInt`.
    - Add `import * as crypto from 'crypto';`.

## Verification
- Grep confirmed removal of `Math.random()` in sensitive contexts.
- Linter runs on modified files report no errors.
- No public APIs changed; behavior preserved besides randomness quality.
