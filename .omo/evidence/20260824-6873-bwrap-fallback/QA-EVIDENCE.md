# WHAT WAS TESTED

Issue #6873: memory reflection with `memory.reflection.sandbox: "auto"` treats an existing
`/usr/bin/bwrap` as usable even when bubblewrap cannot create its user namespace
(AppArmor `apparmor_restrict_unprivileged_userns = 1`), so every reflection child dies with
`bwrap: setting up uid map: Permission denied` and the failure streak grows.

Commands run (repo root, bun 1.3.14):

1. `bun test packages/omo-senpi/src/components/memory/sandbox.test.ts packages/omo-senpi/src/components/memory/sandbox-bwrap-probe.test.ts packages/omo-senpi/src/components/memory/sandbox-absent-paths.test.ts packages/omo-senpi/src/components/memory/worker/remediation.test.ts`
   - Surface: the sandbox transform builders (`auto`/`required`/`off` policies, linux/darwin),
     the new bwrap smoke-probe classifier + memoized probe, and the reflection failure-hint mapper.
   - Behavior proven: auto degrades to unsandboxed with an explicit warning when the probe reports
     bwrap unusable; required fails closed with `SandboxUnavailableError`; a healthy probe result
     keeps wrapping; `off` never probes; classifier maps exit 0 / uid-map denial / spawn error /
     timeout to usable/unusable+reason; remediation names `memory.reflection.sandbox` instead of
     the removed `child-stderr.log` for bwrap setup failures while generic child_exit keeps the log hint.
2. `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
   - Surface: whole omo-senpi package typecheck gate.
3. `bun test packages/omo-senpi/src/components/memory`
   - Surface: full memory component suite (sandbox consumers included: identity-runtime lazy
     transform, facts surface, worker supervision/finalization) to prove no regression.

# WHAT WAS OBSERVED

1. Scoped run after fixes: `29 pass, 1 skip (win32-gated probe test), 0 fail`.
2. Typecheck: exit code 0, no diagnostics.
3. Full memory suite: `911 pass, 6 skip, 0 fail` across 134 files (~326s).
4. Failing-first evidence: before the remediation.ts branch existed, the new
   `worker/remediation.test.ts` case failed (hint still pointed at child-stderr.log); before the
   classifier reason fix, two `classifyBwrapSmoke` cases failed because empty stderr omitted
   `reason` entirely, violating the declared `{ usable: false; reason: string }` shape.
5. Hermeticity check: all pre-existing sandbox tests inject `which`, so they keep existence-only
   semantics and never spawn a real bwrap; only production callers without an injected `which`
   (identity-runtime reflection transform, facts surface) get the real smoke probe, memoized once
   per executable path per process.

# WHY IT IS ENOUGH

- The issue's three asks are each pinned by a test: verify-the-sandbox-can-start (probe +
  classifier tests), auto-retry-unsandboxed-with-explicit-warning vs required-fail-closed
  (policy tests), and no dangling child-stderr.log pointer for sandbox setup failures
  (remediation test).
- The full memory suite covers both production consumers of the changed builder signature, so the
  blast radius (reflection + facts children) is exercised, not just the unit seams.
- Remaining risk: hosts where the smoke test passes but a later real launch still fails at setup
  (race or per-invocation divergence). That path keeps the pre-existing runtime behavior plus the
  new remediation hint, which is the best available degradation without re-probing per launch.

# WHAT WAS OMITTED

- Live Senpi harness QA (`senpi-qa` drivers) was not run in this environment; the hermetic unit
  gate (`tsgo --noEmit -p packages/omo-senpi/tsconfig.json` + scoped/full `bun test`) is the
  recorded evidence. No live driver JSON is included, and none is claimed.
- No secrets, tokens, auth headers, or env dumps are present in this change or its artifacts;
  nothing required redaction beyond this note.
