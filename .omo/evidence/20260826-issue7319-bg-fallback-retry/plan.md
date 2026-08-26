# Plan — issue #7319: background-task fallback must not preempt in-flight retries

Branch: `fix/7319-bg-fallback-retry-window` @ 8c57e463e (origin/dev). No commit/push/PR.

## Root cause

Four trigger sites call `tryFallbackRetry` synchronously on the FIRST retryable
signal, so a transient LLM server error downgrades the task's model immediately,
before OpenCode's own in-flight retry (`session.status: "retry"`) can succeed:

1. `handleSessionErrorEvent` -> `tryFallbackRetry(..., "session.error")`
   (manager.ts:2051). The "session still alive -> treat as transient" guard only
   runs AFTER fallback is impossible.
2. `handleEvent` `session.status` type `"retry"` branch
   (manager.ts:1935) -> immediate takeover while a retry is literally in progress.
3. Polling loop `polling:session.status` (manager.ts:3028) -> same, every 3s poll.
4. `message.updated` assistant-error branch (manager.ts:1657) -> same class.

Asymmetry: `session-status-classifier.ts` classifies `"retry"` as ACTIVE (poller
skips completion), yet handlers 2/3 treat it as an instant failover trigger.

## Fix (issue-proposed, opt-in; default behavior unchanged)

Add `background_task.fallbackDeferMs` (ms, default 0 = today's behavior).
When >0, retryable non-terminal triggers defer the takeover behind a one-shot
timer keyed by task id. At fire time the manager proceeds with
`tryFallbackRetry` ONLY if the session has not recovered:

- task missing / not running -> skip (resolved elsewhere)
- status busy/running -> skip (recovered, actively working)
- status idle + session has assistant/tool output -> skip (recovered)
- status idle without output -> proceed (retry did not save it)
- status retry after full grace -> proceed (retries had their chance)
- terminal status (interrupted etc.) -> skip (completion machinery owns it)
- unknown status / alive-but-absent-from-status-map -> skip (conservative)
- session gone (verifySessionExists false) or statuses unavailable -> proceed

Non-retryable and terminal-classified errors (`shouldRetryError` false /
`isTerminalSessionError` true, e.g. quota-exhaustion provider-failover, "model
not found") bypass the grace entirely: hard-fail downgrade latency unchanged.
Launch-failure paths (`promptAsync.launch`, `promptAsync.resume`) stay
immediate: no in-flight session retry exists to wait for.

## Files

| File | Change |
|------|--------|
| `packages/omo-opencode/src/config/schema/background-task.ts` | add optional `fallbackDeferMs` (int >= 0) |
| `assets/oh-my-opencode.schema.json` | regenerate via `bun run build:schema` |
| NEW `packages/omo-opencode/src/features/background-agent/fallback-deferral.ts` | `createFallbackDeferralTracker({ scheduleFn? })`: one-shot timers per task id, dedupe (first trigger wins), cancel/cancelAll/isPending; injectable scheduler for deterministic tests |
| NEW `packages/omo-opencode/src/features/background-agent/fallback-deferral.test.ts` | tracker unit tests (manual scheduler, no sleeps) |
| NEW `packages/omo-opencode/src/features/background-agent/manager.fallback-defer.test.ts` | RED->GREEN tests over REAL BackgroundManager with fake client |
| `packages/omo-opencode/src/features/background-agent/manager.ts` | config DI (`fallbackDeferral?` in BackgroundManagerConfig), `maybeDeferFallbackTakeover()` gate at 4 sites, fire-time probe `runDeferredFallbackTakeover()`, cancel hooks at terminal transitions (interrupt/error-finalize/cancelTask/complete/failCrashed/scheduleTaskRemoval site ~2888), shutdown cancelAll |
| `docs/reference/configuration.md` | document `fallbackDeferMs` in background_task table |

## TDD sequence

1. Tracker module + unit tests (green immediately; infrastructure only).
2. RED: manager defer tests fail against unfixed manager (immediate downgrade).
3. Wire manager. GREEN.
4. Add permanent-error-prompt-downgrade + default-config regression guards.

## Verification gates

- `bun test .../fallback-deferral.test.ts .../manager.fallback-defer.test.ts` x2 clean
- adjacent suites: manager.polling.test.ts, fallback-retry-handler.test.ts, manager.test.ts (fallback/retry describes), error-classifier.test.ts, session-status-classifier.test.ts
- touched-package tsgo: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- schema freshness test after regen
- `git diff --check`; hygiene grep (`as any`, `@ts-ignore`, `@ts-expect-error`, sleeps)

## QA

Integration fakes drive the real BackgroundManager + real tryFallbackRetry seam
(fake client only). Optional isolated live drive under /tmp with fake LLM
(500-then-success) if environment permits; honest blockers stay blockers.

## Self-audit

Two consecutive post-final-edit waves over the fresh full git diff; ledger of
P0-P3+noise findings; all fallback entry points classified (background tasks:
4 deferred sites + 2 launch-immediate sites; delegated tasks ride
BackgroundManager; main-session runtime-fallback hook is a separate system,
untouched by design).
