# QA notes - issue #6665 delegate-task poll stall detection

## WHAT WAS TESTED

1. Failing-first regression suite `sync-session-poller.stall-detection.test.ts` (6 tests):
   - finish "unknown" + no deliverable + idle + frozen transcript -> fast stalled-subagent error (abort fired once), NOT the inactivity timeout string.
   - finish "unknown" + substantive text deliverable -> resolves null (deliverable path), no abort.
   - Guards: busy status suppresses stall; growing transcript resets the stall timer; pending tool parts suppress stall; finish "tool-calls" stays guarded by the full timeout.
2. Scoped suite: `bun test packages/omo-opencode/src/tools/delegate-task/` -> 493 pass / 0 fail (43 files).
3. Repo typecheck: `bun run typecheck` (tsgo --noEmit root + script + all workspace packages) -> exit 0.

## WHAT WAS OBSERVED

- Pre-implementation baseline (`failing-test-output.txt`): the two regression tests failed exactly as the issue describes - the poll loop burned the full MAX_POLL_TIME_MS (5000ms test window; 30 min in production) and returned "Poll inactivity timeout reached after ...", proving the dead-subagent hang.
- Post-implementation: all 6 pass; the stall paths resolve within a few poll iterations (~12s total file runtime including guard tests that intentionally ride the fake clock to the timeout bound).

## WHY IT IS ENOUGH

- The regression tests reproduce the exact production failure mode from the issue timeline (idle session, empty assistant messages with finish "unknown", frozen transcript) and pin both resolution branches required by the issue: deliverable -> complete/null, no deliverable -> descriptive fail-fast error naming the session ID.
- The four guard tests pin conservatism so the fix cannot prematurely kill live subagents: active status, arriving messages, pending tool parts, and "tool-calls" finishes all keep the previous behavior (full inactivity timeout as the bound).
- The change is confined to `packages/omo-opencode/src/tools/delegate-task/` (2 source files + 1 co-located test); callers are untouched because `stallWindowMs` is optional with a 30s default, mirroring the existing `childWakeGraceMs` input pattern.

## WHAT WAS OMITTED

- Live end-to-end harness QA (real opencode + real provider stream interruption): this environment has no provider credentials and the LSP daemon socket could not start (diagnostics covered by the repo's own tsgo strict gate instead). Risk accepted as low: the change adds a bounded early-exit path behind the same inactive-status gate that already existed, and every existing delegate-task test (493) still passes.
- No secrets, tokens, or env dumps are contained in this evidence directory.
