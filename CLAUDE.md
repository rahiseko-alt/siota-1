# CLAUDE.md

This repository follows the **`template-0811 v3`** development harness and 4-tier rule hierarchy.

Please strictly follow the rules and workflows defined in [`AGENTS.md`](./AGENTS.md).

## Quick Reference
- **Core Principle**: Search first -> Reuse first -> Define the Gap -> Build only the Gap -> Mechanical check -> Real verification (Runtime Evidence).
- **Risk-based flow**:
  - Level 0 (Trivial): `BUILD` -> `VERIFY`
  - Level 1 (Normal): `EXPLORE` -> `BUILD` -> `MECHANICAL CHECK` -> `VERIFY`
  - Level 2 (Important): `EXPLORE` -> `FAILURE MATCH` -> `BUILD` -> `MECHANICAL CHECK` -> `INDEPENDENT CRITIC` -> `WRITER FIX` -> `VERIFY`
  - Level 3 (Critical): `EXPLORE` -> `FAILURE MATCH` -> `BUILD` -> `MECHANICAL CHECK` -> `INDEPENDENT CRITIC` -> `WRITER FIX` -> `AUTOMATED TEST` -> `RUNTIME VERIFY` -> `INDEPENDENT VERIFIER`
- **In / Out**: Read `docs/handoff.md` at start; update `docs/handoff.md` and append to `docs/failures.md` (if failure occurred) at finish.
