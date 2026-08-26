# Self-audit ledger - mechanical state machine

Contract: each wave re-reads the fresh full git diff from disk plus adjacent
callers/owners/teardown/error/platform paths; maintains P0/P1/P2/P3/noise
findings; challenges regression preconditions, original-code RED reasons,
false-pass races, assertion-failure cleanup. Any edit (incl. tests/comments/
evidence) resets clean_streak=0 and starts a new wave. The finding wave never
counts clean. Stop only after two consecutive post-final-edit waves with empty
ledgers.

## Wave 1 (wave_number=1, clean_streak=0 at start)

Scope: full diff (940 lines) + callers of resolveModelForDelegateTask
(senpi-task category/agent chains, omo-opencode delegate-task shims),
validateSessionHasOutput call sites (idle handler, polling x3),
failCrashedTask teardown tail, prefix logic across providers
(model-resolution-pipeline / fallback-chain-from-models /
provider-model-id-transform / selectFallbackProvider untouched-by-design).

Findings:
- **P2-1** `loadFreshConfigSnapshot` ignored `validation.valid`: a mid-session
  BROKEN omo.json would apply partially-parsed config instead of failing closed
  to the boot snapshot. FIXED: invalid -> log + return undefined (snapshot).
- **P3-1** `getSisyphusJuniorModelOverride` duplicated between
  fresh-config-snapshot.ts and plugin/tool-registry-team-tools.ts. FIXED:
  single definition in fresh-config-snapshot.ts; team-tools imports and
  re-exports (no import cycle: fresh-config-snapshot imports only
  config/validate + shared/logger + omo-config-core type).
- Noise (accepted): per-spawn validatePluginConfig IO also runs on task_id
  continuation paths where the stored task model is used anyway; bounded cost,
  graceful fallback.
Edits applied -> clean_streak reset to 0. Gates re-run post-edit (see gates.md):
tsgo x3 OK, focused suites 1605 pass / 0 fail.

## Wave 2 (wave_number=2, first post-final-edit wave)

Scope: fresh diff re-read incl. wave-1 edits; cycle check on new
plugin->tools/delegate-task import (none); all loadFreshConfigSnapshot callers
(only tools.ts); canonicalizeModelID consistency between cache-membership check
and existing no-op check; senpi-task consumer suite green (1753).
Regression preconditions challenged:
- stricter assistant-text gate vs tool-only deliverables: old behavior produced
  COMPLETED + "(No text output)" - the reported defect; new behavior is the fix.
- memo removal perf: validation runs only on idle/terminal/gone paths, not every poll.
False-pass races: D3 fetch-error test window proven by RED (old code completed
inside it); idle-handler tests use the file's established microtask-flush pattern.
Findings: NONE. clean_streak=1.

## Wave 3 (wave_number=3)

Scope: full manager/handler/retry/model-core/delegate-core diff hunks re-read
from disk; leftover-reference scan (zero observedOutputSessions refs; tsgo
green); test-coherence check (polling rename pins messagesCallCount=1;
parent-wake tests keep primary wake-hold assertions).
Design note (reviewed, ACCEPTED as intended, not a defect): idle-without-output
on an exhausted/absent chain fails the task BEFORE the incomplete-todos wait.
Only reachable when the session has ZERO assistant text in its entire history -
exactly the "dead spawn" state the issue requires to surface a hard failure.
Findings: NONE. clean_streak=2 -> STOP per contract.
