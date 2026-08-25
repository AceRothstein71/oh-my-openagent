# QA Evidence - issue #6808 Kimi-only quick route quota-403 recovery

## WHAT WAS TESTED

- `bun test packages/omo-senpi/src/components/memory/worker/model-miss.test.ts packages/omo-senpi/src/components/memory/worker/memory-model-attempts.test.ts`
  - Failing-first: two new regression tests written BEFORE the fix, run RED, then the
    classifier fix applied and the same run went GREEN.
  - Behavior proven: Kimi's billing-cycle response (`403 permission_error` +
    "You've reached your usage limit for this billing cycle", exact issue #6808 payload)
    classifies as retryable `provider_unavailable`, so `runMemoryModelAttempts`
    advances to the next candidate instead of recording a dead reflection run.
- `bun test packages/omo-senpi/src/components/memory/worker` (full worker suite,
  all consumers of `model-miss.ts` including `run-outcome-publication.ts`).
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` (Senpi type gate).

## WHAT WAS OBSERVED

- RED (before fix), verbatim assertion failures:
  - `classifyRetryableModelMiss > #given a kimi billing-cycle quota 403 child failure ...`:
    expected `{kind:"provider_unavailable", detail:"403 permission_error | You've reached your usage limit for this billing cycle"}`, received `undefined`.
  - `runMemoryModelAttempts > #given a kimi billing-cycle quota 403 on the primary ...`:
    expected attempted `["extension-only/primary","builtin/fallback"]`, received only
    `["extension-only/primary"]` (chain did not advance).
  - 15 pre-existing tests passed in the same run.
- GREEN (after fix): scoped run 17 pass / 0 fail (`test-scoped-green.log`);
  full worker suite 222 pass / 0 fail across 35 files (`test-worker-green.log`);
  typecheck exit code 0 (`typecheck.log`).
- Terminal semantics preserved: generic org-quota ("Error: quota exceeded for this
  organization"), bare `403 permission_error` without the billing-cycle usage-limit
  text, context-length, timeout, and success cases all stayed non-retryable
  (existing + new negative pins green).

## WHY IT IS ENOUGH

The two new tests pin both halves of the recovery contract at the exact seam that
changed: classification (retryable with both error lines preserved) and chain
advance (fallback candidate actually attempted and returned). The full worker suite
covers every consumer of the classifier, including exhausted-chain fingerprinting
and outcome publication. The shared model-core STOP table is untouched, so all other
consumers (OpenCode runtime-fallback, delegate routing) keep byte-identical behavior;
the Senpi type gate proves no interface drift. Residual risk: a future Kimi payload
rewording could evade the two regexes; the negative pin keeps any such drift visible.

## WHAT WAS OMITTED

- No live Senpi driver run: this change is a pure unit-seam classifier edit with no
  spawn/supervisor surface change; per task scope the verification gate is scoped bun
  tests + typecheck. The worker suite includes the supervisor/runner integration tests.
- Raw env dumps, credentials, provider logs: none copied; only test summaries and
  exit codes are recorded.
- `bun run test:senpi` full package gate not executed: its materialize pre-step is a
  known environment failure on this Windows-linked worktree under WSL (documented in
  the sibling PR #6834 evidence); the equivalent core steps (worker suite + tsgo)
  were run directly and are recorded here.
- `bun install` ran once: dependency installation succeeded (tests + tsgo executed
  against the installed tree); its postinstall `prepare` step failed in
  `build:materialize-frontend` with exit 1 - the same pre-existing WSL
  Windows-linked-worktree `.git` pointer incompatibility, harmless for this change.
- payload.test.ts env-pre-existing failure: not hit in any scoped run.
