Title: CWE-561 Dead Code Remediation Summary

Scope: Review and remediation across selected services referenced by CWE-561 report

Files reviewed
- src/tariff/tariff.service.ts
- src/balancing/balancing.service.ts
- src/capacity-v2/capacity-middle.service.ts
- src/export-files/export-files.service.ts
- src/astos/astos.service.ts
- src/export-files/export-file-tariff-commodity-a2.service.ts
- src/capacity-v2/capacity-v2.service.ts

Changes applied
1) src/capacity-v2/capacity-v2.service.ts
   - Removed an unintended early return that caused all subsequent logic in the function to be unreachable. This was a true CWE-561 defect that prevented versioning logic and database writes from executing.

Observations (no change required)
- src/tariff/tariff.service.ts: The segment around the flagged location constructs records intentionally with nullable quantity fields. No provable dead/unreachable code was identified at that exact location.
- src/balancing/balancing.service.ts: The flagged lines correspond to commented-out diagnostic code or optional output assembly. No unreachable production code detected at those markers.
- src/capacity-v2/capacity-middle.service.ts: The flagged areas include batching logic that is executed based on data presence checks. No unreachable blocks detected.
- src/export-files/export-files.service.ts: The flagged markers point to commented reference code and control flow that is exercised at runtime.
- src/astos/astos.service.ts and src/export-files/export-file-tariff-commodity-a2.service.ts: Code paths at the flagged lines are reachable and used; only commented logs were found.

Risk notes
- Removing the early return in capacity-v2 may expose previously skipped logic; this is the intended fix. Downstream behavior depends on database content and should be validated in QA with representative data.

Recommendations
- Consider removing leftover console.log statements in hot paths after functional QA.
- Enable CI rules to flag unreachable code (TS compiler options noFallthroughCasesInSwitch, eslint no-unreachable) and unused variables.

Status
- Remediation completed where a clear CWE-561 defect was confirmed (capacity-v2.service.ts). Other flagged locations were reviewed; no unreachable code was found.


