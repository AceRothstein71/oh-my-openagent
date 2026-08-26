# Self-audit ledger - mechanical wave state machine

State: `wave_number` / `clean_streak` tracked below. Rule: every wave re-reads
the fresh full git diff from disk plus adjacent callers/owners/teardown/error
paths; any code/test/comment/evidence-affecting edit resets clean_streak=0 and
starts a new full wave. Finding waves never count as clean. Stop only after two
consecutive post-final-edit waves with empty new-finding ledgers.

Entry points classified (goal requirement):

| Entry point | Trigger source | Treatment |
|-------------|----------------|-----------|
| background task, session.error | `"session.error"` | deferred when retryable+non-terminal |
| background task, status event | `"session.status"` (type retry) | deferred |
| background task, poller | `"polling:session.status"` | deferred |
| background task, assistant msg error | `"message.updated"` | deferred |
| background task, launch failure | `"promptAsync.launch"` / `"promptAsync.resume"` | immediate BY DESIGN: no in-flight session retry exists to wait for; deferring adds latency with zero recovery chance |
| delegated tasks (`task` tool) | delegate-task -> BackgroundManager launch with fallbackChain | covered by the same seam; no separate handler |
| main session | `hooks/runtime-fallback/` reactive system | OUT OF SCOPE by design: independent system per AGENTS.md invariant "two fallback systems ... operate independently"; touching it would change unrelated downgrade policies (forbidden) |

Retryable vs terminal classification (unchanged classifiers, only gating):
- retryable = model-core `shouldRetryError` (rate limit, 5xx, timeouts of
  transport class, provider errors) OR provider-exhaustion eligibility.
- terminal = `isTerminalSessionError` patterns (provider/model unresolvable,
  missing keys) and non-retryable stop errors (quota/billing death).
- Gate: defer ONLY if `shouldRetryError && !isTerminalSessionError`. Quota
  exhaustion (stop error, exhaustion-eligible) bypasses grace -> immediate
  provider failover. Terminal bypasses grace -> immediate.

## Wave 1 (post-final-edit; last code edit = polling fixture message fix)

Diff re-read from disk: `/tmp/opencode/wave-diff.txt` (281 lines, manager.ts +
schema). Adjacent paths checked: create-managers.ts constructor wiring (single
production site; pluginConfig.background_task flows fallbackDeferMs
automatically), delegate-task/background-task.ts (delegated lane),
attempt-lifecycle.ts (owner of attempt bookkeeping), abort-with-timeout,
session-status-classifier, error-classifier, shutdown/cancel/fail/interrupt/
complete teardown sites.

Findings and adjudication:

- **P3-1** cancelTask's main (non-skipNotification) path has no explicit
  deferral cancel; only the skip branch does. Adjudicated ACCEPT, no edit: this
  mirrors the pre-existing idleDeferralTimers lifecycle asymmetry exactly
  (main path never cleared idle timers either); the fire-time
  `status !== "running"` guard makes a post-cancel fire a verified no-op
  (test 13 proves it). Adding cancel only there would diverge from the
  convention the change deliberately mirrors.
- **P3-2** idle-without-output fire can race the poller's stability-based
  completion. Adjudicated ACCEPT, no edit: the race surface pre-exists between
  error-path fallback and the poller today; deferral only shifts timing for
  users who opt in, and both contenders check/mutate task.status so first
  writer wins deterministically enough for either outcome to be user-correct.
- **noise-1** `!sessionID` branch in runDeferredFallbackTakeover is unreachable
  from all four trigger sites (each resolves the task BY sessionId). Kept as
  cheap defensive symmetry with tryFallbackRetry's own handling.
- **noise-2** tests skip `manager.shutdown()` when an assertion throws.
  Matches the existing convention in manager.test.ts/polling tests; manual
  scheduler means no real deferral timers leak; bun test-setup resets shared
  state between tests.
- **noise-3** feasibility-probe build regenerated unrelated tracked bundles;
  restored via git checkout before audit. Not part of the change surface.

Regression-precondition challenges (all answered):
- Default behavior byte-for-byte? Gate returns false on `deferMs <= 0` before
  touching anything; 765 dir tests + existing retry describes green.
- Original-code RED reason? Pre-fix manager downgraded immediately: 9 failures,
  all attemptCount/status assertions proving takeover inside what should be the
  grace window (red-run.txt).
- False-pass races? Manual scheduler removes timer flake;
  `drainEventHandlers()` (macrotask yield) runs after all pending microtasks of
  the void-dispatched async handlers; suite stable across 4+ runs including
  full-dir run.
- Assertion-failure cleanup? Covered under noise-2.

New findings requiring action: NONE (all entries adjudicated above).

## Wave 2

Re-verified fresh diff after evidence writes (no code edits since wave 1):
re-checked each carried item still holds (P3-1/P3-2 unchanged, noise items
unchanged), re-hunted: concurrency release ordering at fire (tryFallbackRetry
releases + requeues exactly as the immediate path always did), double-defer
across sources (dedupe by taskId holds; second source cannot schedule),
shutdown-then-fire (cancelAll clears pending; fired-after-shutdown callback
would hit `tasks.get !== task` guard only if tasks were mutated - shutdown does
not clear tasks map, but polling is stopped and process is exiting; accepted as
pre-existing shutdown semantics shared with completionTimers/idleDeferralTimers
which are also simply cleared), schema/docs/config key name consistency
(`fallbackDeferMs` identical in schema, docs, manager read).

New findings requiring action: NONE.

clean_streak = 2 (waves 1 and 2 post-final-edit with empty new-finding ledgers;
carried adjudications documented above). Audit gate satisfied.
