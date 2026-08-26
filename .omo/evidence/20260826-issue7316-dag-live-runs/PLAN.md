# Plan - issue #7316: omo.dag.updated emits runs:[] while a run is live

Branch: fix/7316-dag-updated-live-runs @ base 8c57e463e. Dirty-tree delivery, no commit/push.

## Root causes

### Defect 1 - attach() emits the wholesale snapshot before recovery runs
`packages/omo-senpi/src/components/task/dag-runtime.ts` attach(): `bridge.attach()` (line 441)
runs BEFORE `await recovery.resumePausedRuns(sessionId)` (line 446) and the ensureScheduled loop
(line 450). attach() awaits the FULL recovery (resumeClaimedRun awaits scheduler.run()), so the
bridge's 50ms-debounced `omo.dag.updated` flush fires mid-recovery and reports pre-recovery
on-disk state (paused / stale nodes) to hosts that treat a missing live run as completed.

### Defect 2 - parentSessionId-scoped ownership orphans runs across session-id changes
Dag run records key ownership solely on `parentSessionId`
(`recovery.ts:127` resume pre-filter, `recovery.ts:142` claim foreign_session skip,
`manager.ts:250` list filter). After fork / compaction / restart under a new session id:
manager.list(newId) = [], resumePausedRuns skips as foreign_session, omo.dag.list returns [].
The run is invisible AND unresumable while its node children may still be working.

## Fixes

1. dag-runtime.ts attach(): move `bridge.attach()` AFTER recovery.resumePausedRuns + the
   ensureScheduled loop. No other ordering changes (wake/sessionStart/activity sync keep order).
2. recovery.ts explicit adoption path on resume:
   - Outer resumePausedRuns loop: replace the hard `parentSessionId !==` pre-filter with a
     terminal-status pre-filter so paused foreign runs reach the claim path.
   - claimPausedRun guard order under the run lock:
     a. not paused -> skipped/not_paused (unchanged)
     b. foreign session -> adopt ONLY with durable proof the predecessor host is dead:
        priorHolder = leaseHolderPid ?? previousLeaseHolderPid; require priorHolder defined AND
        !isProcessAlive(priorHolder); then rewrite parentSessionId to the resuming session plus
        leaseHolderPid=hostPid in ONE checkpoint write; else skipped/foreign_session (silent,
        unchanged visibility).
     c. same session -> unchanged live_lease guard then claim.
   - Anti-leak story: a live prior holder means some live host still owns the run (covers
     multi-session hosts sharing one process); no dead-holder proof means no adoption.
     rootSessionId is preserved (lineage provenance); only parentSessionId is rewritten.
   - Residual limitation (documented): adoption keys on host liveness, not thread lineage;
     a resumed successor that attaches after an unrelated session adopted first sees the run
     owned by that session. Strictly better than permanent invisibility; full lineage keying
     needs host-side lineage APIs that do not exist today.

## Tests (TDD RED before GREEN)

- packages/senpi-task/src/dag/recovery.test.ts: rewrite the "foreign paused run is not claimed"
  test into (a) foreign paused + LIVE prior holder -> skipped live_lease outcome, record
  untouched; (b) foreign paused + DEAD prior holder -> resumed, record.parentSessionId rewritten
  to the resuming session, rootSessionId preserved, child dispatched.
- packages/omo-senpi/src/components/task/dag-runtime.test.ts:
  (c) cross-session adapter test: seed paused run owned by session-old with dead
  previousLeaseHolderPid; engine sessionId=session-new; attach(); expect the child dispatched
  (adoption), NO omo.dag.updated emitted mid-recovery (defect 1), and after settle+attach the
  flushed snapshot contains the run with status completed, record owned by session-new, and a
  durable dag.run.resumed event (defect 2).
  (d) same-session ordering test: paused run, attach() blocked mid-recovery on an unsettled
  child; flushing bridge timers mid-recovery must emit NOTHING; after settle the single flushed
  snapshot reflects recovered state (defect 1 pinned without session change).

## Gates

- bun test packages/senpi-task/src/dag/recovery.test.ts (x2 consecutive clean)
- bun test packages/omo-senpi/src/components/task/dag-runtime.test.ts (x2 consecutive clean)
- tsgo --noEmit -p packages/senpi-task/tsconfig.json
- tsgo --noEmit -p packages/omo-senpi/tsconfig.json
- git diff --check
- hygiene scan: no new any/as-casts/@ts-ignore/non-null assertions (branded-id casts follow the
  existing domain convention)

## QA (senpi discipline)

Surface = senpi DAG runtime (packages/omo-senpi task component + senpi-task dag engine).
Unit/integration coverage above drives the real composition root (composeTaskEngine +
createDagRuntime + FakeExtensionAPI) against real filesystem stores in temp dirs. Live driver
(dag-paused-header-qa.ts / task-e2e.mjs) requires the senpi binary; if absent, SKIP is recorded
honestly as a blocker per AGENTS.md ("SKIP is NOT a pass"). Sandboxes under /tmp only; real
~/.senpi/agent never touched; isolation proof recorded.

## Verification commands recorded per gate in gates.log
