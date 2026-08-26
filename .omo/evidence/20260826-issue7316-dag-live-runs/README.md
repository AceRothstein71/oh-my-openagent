# Evidence - issue #7316: omo.dag.updated can emit runs:[] while a run is live

Branch `fix/7316-dag-updated-live-runs` @ base 8c57e463e. Dirty-tree delivery; no commit/push/PR.

## Root causes (x2)

1. **Attach ordering** (`packages/omo-senpi/src/components/task/dag-runtime.ts`): `attach()` armed
   the RPC bridge's debounced wholesale snapshot BEFORE `recovery.resumePausedRuns()`. attach()
   awaits full recovery, so the 50ms-debounced `omo.dag.updated` flush fired mid-recovery and
   reported pre-recovery on-disk state to hosts that read "run missing from snapshot" as completed.
2. **parentSessionId-only ownership** (`packages/senpi-task/src/dag/recovery.ts`,
   `manager.ts` list filter): after fork / compaction / restart under a new session id, the
   stranded run matched no query: list = [], resume skipped as foreign_session, omo.dag.list = [].
   Invisible AND unresumable while its node children kept working.

## Fixes

1. `dag-runtime.ts attach()`: bridge attaches first (ledger + heartbeat stay live so recovery-era
   events, including the scheduler overflow marker, still reach viewers), but wholesale snapshots
   are SUSPENDED until recovery + ensureScheduled settle, then one honest snapshot is scheduled.
   New seam: `DagRpcBridge.setSnapshotsSuspended(bool)` (contract + bridge + detach reset).
2. `recovery.ts`: explicit adoption path on resume. Guard order under the run lock:
   not_paused -> foreign (adopt ONLY with durable proof the predecessor host is dead:
   priorHolder = leaseHolderPid ?? previousLeaseHolderPid defined AND !isAlive -> rewrite
   parentSessionId to the resuming session in the same checkpoint write as the lease claim;
   rootSessionId preserved) -> same-session live_lease guard -> claim. Outer loop pre-filter
   switched from parentSessionId to terminal-status so stranded paused runs reach the claim path.
   Anti-leak: a live prior holder means a live session still owns the run; no death proof means
   no adoption. Residual limitation documented in code: adoption keys on host liveness, not
   thread lineage; full lineage keying needs host-side lineage APIs that do not exist today.

## TDD

- RED logs: RED-recovery.log (adoption test failed: outcome undefined), RED-runtime-adopt.log
  (cross-session: no dispatch -> within() timeout), RED-runtime-order.log (mid-recovery stale
  `omo.dag.updated` emitted with pre-recovery state).
- GREEN: GREEN-gates-run1.log / GREEN-gates-run2.log (two consecutive clean runs).

## Gates (all recorded in this directory)

- `bun test packages/senpi-task/src/dag/recovery.test.ts` x2: 15 pass / 0 fail both runs.
- `bun test packages/omo-senpi/src/components/task/dag-runtime.test.ts
  packages/omo-senpi/src/components/task/dag-rpc-bridge.test.ts` x2: 46 pass / 0 fail both runs.
- Regression sweep: `bun test packages/senpi-task/src/dag` 251 pass / 0 fail;
  `bun test packages/omo-senpi/src/components/task` 488 pass / 0 fail;
  `bun test packages/omo-senpi` full: 2273 pass / 7 skip / 0 fail (twice; 7 skips are
  pre-existing capability-gated component tests).
- `tsgo --noEmit -p packages/senpi-task/tsconfig.json`: exit 0.
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`: exit 0.
- `git diff --check`: clean.
- Hygiene scan of added lines: zero `as any` / `@ts-ignore` / `@ts-expect-error` /
  non-null assertions / `as unknown`. Branded-id casts (`as DagRunId`) follow the existing
  domain convention; test payload narrowing uses type guards, not casts.
- Decomposed `bun run test:senpi` (script itself BLOCKED by env, see gates-senpi-gate-decomposed.log):
  build step blocked by sandbox git-worktree failure (pre-existing env quirk), remaining three
  components green.

## QA verdicts

See qa-transcript.md. Short form: composition-root integration proof PASS; live senpi-binary
harness BLOCKED (binary absent; DAG-specific driver additionally crashes pre-sandbox on a
stash-verified pre-existing pi-tui warm-up defect on the untouched base). Real ~/.senpi/agent
digest unchanged across all QA steps.

## What was omitted

Raw env dumps and home-directory listings beyond digests; no secrets captured.

## Self-audit

See self-audit-ledger.md for wave_number / clean_streak records.
