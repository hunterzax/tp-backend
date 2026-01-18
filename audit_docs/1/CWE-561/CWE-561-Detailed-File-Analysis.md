Title: CWE-561 Detailed File Analysis

Reference input: CWE-561: Dead code.md (external line references mapped to current repo where applicable)

1) src/capacity-v2/capacity-v2.service.ts
- Finding: Unreachable code due to early `return;` before persistence logic (around current file ~L3939).
- Impact: Bypassed version updates and related DB writes; subsequent logic never executed.
- Fix: Removed the early `return;` so that update/create flows proceed.
- Verification: Lint passes; requires functional QA with booking/version creation flows.

2) src/tariff/tariff.service.ts
- Finding: Flagged lines (circa ~L2762) create a mapped object with a `null` quantity. This is executed (array literal mapped) and appears intentional for a specific charge type. No unreachable code detected.
- Action: No code change. Recommend product validation to confirm business rule for `damageChageB` with `quantity=null` is intended.

3) src/balancing/balancing.service.ts
- Findings at markers (~L3977, ~L5116, ~L5140, ~L9521, ~L8818, ~L9376): Reviewed nearby blocks.
  - Observed commented-out optional spreads and console diagnostics.
  - Active return statements are at function ends with reachable paths.
- Action: No code change. Consider pruning commented code and logs post-QA.

4) src/capacity-v2/capacity-middle.service.ts
- Findings at markers (~L1330, ~L1926): Logic is gated by data checks and proceeds into batch operations.
- Action: No code change. Flow is reachable based on upstream conditions.

5) src/export-files/export-files.service.ts
- Findings at markers (~L11301, ~L15376): Nearby code is active and executed; commented alternative calls exist for reference.
- Action: No code change.

6) src/astos/astos.service.ts (~L351)
- Finding: Branching selects and pushes values into accumulation. Only commented logs present.
- Action: No code change.

7) src/export-files/export-file-tariff-commodity-a2.service.ts (~L104-106)
- Finding: Data shaping for worksheet output; executed normally. No unreachable logic.
- Action: No code change.

Notes on mapping
- The original CWE-561 line numbers referenced another codebase path. We mapped to current repository files and inspected the closest corresponding ranges.

General recommendations
- Enforce ESLint rules: `no-unreachable`, `no-unused-vars`, `@typescript-eslint/no-unused-vars` in CI.
- Remove debug logging in performance-sensitive sections after validation.


