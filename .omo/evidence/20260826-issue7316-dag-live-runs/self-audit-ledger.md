# Self-audit ledger - issue #7316 dag live-runs

State machine: wave_number + clean_streak. Every wave re-read the fresh full git diff from disk
plus adjacent caller/owner/teardown paths. Any edit (code/tests/comments/evidence) resets
clean_streak=0 and starts a new full wave after gates. Finding waves never count clean.
Stop condition: two consecutive post-final-edit waves with empty P0-P3 ledgers.

## Wave 1 (finding wave - clean_streak 0)

Scope: full diff of recovery.ts, dag-runtime.ts, dag-rpc-bridge.ts, dag-rpc-bridge-contract.ts;
adjacent paths: store.withRunLock semantics, DagRpcBridge implementors, reload-guard,
wake-source, status-ui, pauseRunsForShutdown interplay, journal replay vs ownership rewrite.

Findings:
- [noise] flushSnapshot did not itself check snapshotsSuspended (only the arming path did).
  Unreachable today (single arming path, timer cancelled on suspend) but a latent trap.
  RESOLVED IN-WAVE: added the flag check to flushSnapshot. Edit -> gates rerun
  (GREEN-gates-post-wave1.log: 15+46 pass, tsgo x2 OK, diff-check OK).
- [noise] adoption ownership transfer is checkpoint-only, not a journaled boundary event.
  Accepted by decision: no event vocabulary carries parentSessionId; adding one extends the
  17-type schema (out of scope); projection state is correct and replay cannot clobber it.
- [noise] widened lock attempts now cover foreign non-terminal runs: bounded contention only;
  withLock breaks stale locks via liveness probe; live foreign hosts hold locks no longer than
  their own operations.

Regression preconditions challenged: RED failures were mechanism-exact (no dispatch for
adoption; stale mid-recovery emission for ordering), not setup errors. False-pass races: runtime
tests use ManualTimers + whenStarted synchronization; mid-recovery silence is enforced by a
cancelled timer, not timing luck; the subscriber-ring test pins ledger forwarding during
recovery. Assertion-failure cleanup: mkdtemp roots removed in afterEach; runtimes disposed
in-test; failure leakage is OS-tmp scoped like the existing suite.

## Wave 2 (finding wave - clean_streak reset to 0 by edit)

Scope: fresh full diffstat from disk + event-bridge session-start chain + wireDagLifecycle
ordering + generated-bundle state.

Findings:
- [P2] The aborted `bun run test:senpi` build left four regenerated tracked extension bundles
  (plugin/extensions/{omo,omo-task,omo-member,omo-memory-mcp}.js) in the tree; three were
  stamp-only churn, omo-task.js carried my compiled logic but from a build that aborted
  mid-pipeline in a broken sandbox (git worktree failures). RESOLVED: `git checkout --` the four
  files; bundle regeneration belongs in a dedicated build commit by the PR author/CI.
  Edit -> gates rerun (GREEN-gates-post-wave2.log: all green).

## Wave 3 (clean wave 1 - clean_streak 1)

Scope: fresh re-read of recovery.test.ts and dag-runtime.test.ts / dag-rpc-bridge.test.ts diffs
from disk; reload-guard + wake-source list seams; lifecycle order (DAG pause -> task lifecycle
reconcile -> DAG attach on session_start); adopted-run child revival flows through recovery's
taskId-keyed reattach path (session-id independent).

Ledger: EMPTY (no P0/P1/P2/P3, no new noise).

## Wave 4 (clean wave 2 - clean_streak 2)

Scope: fresh re-read of all seven changed files' diffs from disk; added-test assertion quality
(no weakened assertions; rewritten foreign-session test is strictly stronger); gate health rerun
(GREEN-gates-wave4.log: 15+46 pass).

Ledger: EMPTY.

## Stop

Two consecutive post-final-edit zero-finding waves (3, 4). Stopped.

Commands used per wave: `git diff <files>`, `git diff --stat`, targeted reads of adjacent
modules, focused bun test runs, tsgo --noEmit per package, git diff --check.
