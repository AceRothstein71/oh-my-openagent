# Issue #7319 - background-task fallback takes over before a retry can succeed

Branch: `fix/7319-bg-fallback-retry-window` @ base 8c57e463e (origin/dev). Dirty tree, no commit/push/PR.

## Root cause

Four background-agent trigger sites call `tryFallbackRetry` synchronously on the
first retryable signal, so a transient LLM server error (rate limit, 5xx)
downgrades the task's model immediately instead of letting OpenCode's in-flight
session retry (`session.status: "retry"`) recover:

1. `handleSessionErrorEvent` -> `"session.error"` (the alive-session transient
   guard only ran on the non-retryable branch).
2. `handleEvent` session.status `"retry"` event branch.
3. Poller `"polling:session.status"` branch (every 3 s while retrying).
4. `message.updated` assistant-error branch.

Asymmetry: `session-status-classifier.ts` classifies `"retry"` as ACTIVE, yet
sites 2/3 treated it as an instant failover trigger.

## Fix

Opt-in grace period `background_task.fallbackDeferMs` (default 0 = today's
behavior, byte-for-byte unchanged):

- Retryable, non-terminal triggers defer the takeover behind a one-shot timer
  per task id (first trigger wins; repeats do not extend or duplicate).
- At fire time the manager proceeds ONLY if the task is still running AND the
  session has not recovered: busy/running -> skip; idle with output -> skip;
  idle without output / still-retrying / dead session / statuses unavailable ->
  proceed; terminal or unknown status -> skip; alive-but-absent-from-map ->
  conservative skip.
- Terminal-classified (`isTerminalSessionError`, e.g. "model not found") and
  non-retryable errors (quota-exhaustion provider failover) bypass the grace:
  hard-fail downgrade latency unchanged.
- Launch-failure sources (`promptAsync.launch`, `promptAsync.resume`) stay
  immediate: no in-flight session retry exists there.
- Deferral timers cancelled at every terminal transition (interrupt,
  error-finalize, cancel-skip, complete, removal-error, fail-crashed) plus
  shutdown `cancelAll()` and defensive cancel on successful fallback; the
  fire-time `status === "running"` guard makes any stray fire a no-op.

Delegated tasks flow through the same BackgroundManager seam (delegate-task
launches with fallbackChain), so they are covered. Main-session runtime-fallback
(`hooks/runtime-fallback/`) is a separate reactive system and is intentionally
untouched.

## Files

| File | Change |
|------|--------|
| `packages/omo-opencode/src/config/schema/background-task.ts` | +`fallbackDeferMs` (int >= 0, optional) |
| `assets/oh-my-opencode.schema.json`, `assets/omo.schema.json` | regenerated (`bun run build:schema`) |
| `packages/omo-opencode/src/features/background-agent/fallback-deferral.ts` | NEW injectable one-shot deferral tracker |
| `packages/omo-opencode/src/features/background-agent/fallback-deferral.test.ts` | NEW tracker unit tests |
| `packages/omo-opencode/src/features/background-agent/manager.fallback-defer.test.ts` | NEW 15-scenario suite over real BackgroundManager |
| `packages/omo-opencode/src/features/background-agent/manager.ts` | gate at 4 sites, fire-time probe, cleanup hooks, DI option |
| `docs/reference/configuration.md` | documents `fallbackDeferMs` |

Diffstat: 6 files changed (+165/-2) plus 3 new files (~600 LOC incl. tests).

## Evidence index

- `plan.md` - mandatory pre-edit plan
- `red-run.txt` - RED: 9 failures, all immediate-downgrade-despite-grace
- `red-green.md` - RED/GREEN narrative
- `gates.md` - focused tests x2, background-agent dir 765 pass, tsgo, schema freshness, git diff --check, hygiene scan
- `qa.md` - integration-fakes verdict + live-server drive results + honest blocker
- `self-audit-ledger.md` - wave state machine, P0-P3+noise ledger, two-wave rule
- `cleanup-receipt.md` - QA process/port teardown + isolation proof
