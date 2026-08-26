# RED / GREEN

## RED (before manager wiring)

Command: `bun test packages/omo-opencode/src/features/background-agent/manager.fallback-defer.test.ts`
Full output: `red-run.txt`

Result: 6 pass / **9 fail** / 25 expect calls. Every failure is the defect
class from issue #7319: with `fallbackDeferMs` configured, the manager still
downgraded immediately on the first retryable signal:

- session.status retry + recovery-before-grace -> downgraded anyway (FAIL)
- grace-expiry takeover asserted "still running before fire" -> already
  attemptCount=1 (FAIL)
- repeated retry signals -> immediate single downgrade, no window (FAIL)
- transient session.error + recovery -> downgraded anyway (FAIL)
- polling retry status -> downgraded on first poll (FAIL)
- idle-with-output recovery -> downgraded anyway (FAIL)
- message.updated assistant error + recovery -> downgraded anyway (FAIL)
- cancel-during-grace and shutdown-cancel -> no deferral machinery existed (FAIL)

Two fixture-only failures also present pre-fix (polling fakes without a retry
message can never downgrade in old OR new code - `shouldRetryError` false);
these were corrected to carry `"Provider is overloaded"` like the existing repo
tests. Not silent passes: they assert the still-running intermediate state.

## GREEN (after wiring)

Same command: **22 pass / 0 fail** (15 manager scenarios + 7 tracker unit tests).
Second clean pass recorded in `green-focused-pass2.txt`.

Scenario coverage map:

| # | Scenario | Asserts |
|---|----------|---------|
| 1 | status-retry event, recovered (busy) at fire | no downgrade |
| 2 | status-retry event, still retrying at fire | downgrade only after grace |
| 3 | 3x repeated signals | exactly one timer, one takeover |
| 4 | transient session.error, recovered | no downgrade |
| 5 | session.error, session dead at fire | downgrade proceeds |
| 6 | terminal "Model not found" error | immediate despite grace, 0 scheduled |
| 7 | quota-exhaustion stop error | immediate provider failover, 0 scheduled |
| 8 | poller retry, recovered by fire | no downgrade |
| 9 | poller retry, no recovery | downgrade after grace |
| 10 | idle with output at fire | skip |
| 11 | idle without output at fire | proceed |
| 12 | message.updated error, recovered | no downgrade |
| 13 | cancel during grace | late fire no-op |
| 14 | shutdown during grace | pending deferrals cancelled |
| 15 | default config (deferMs absent) | immediate takeover preserved |

Determinism: scheduler injected (`FallbackDeferralScheduleFn`); manual
fire-all instead of sleeps; the only real-timer use is tracker test 7 (5 ms,
cancelled synchronously).
