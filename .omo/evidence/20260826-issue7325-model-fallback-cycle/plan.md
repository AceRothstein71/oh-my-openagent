# Plan: Fix issue #7325 - subagent model config ignored, wrong-prefix fallback chain, COMPLETED with empty output

Worktree: /home/viprix/projects/oom-wt-7325 | Branch: fix/7325-subagent-model-fallback-cycle | Base: 8c57e463e (origin/dev)

## Root causes (mapped via exploration, verified by direct reads)

### D1 - configured per-subagent models ignored on spawn (stale)
- `createDelegateTask` tool closure captures `agentOverrides` / `userCategories` /
  `sisyphusJuniorModel` from the boot-time `pluginConfig` snapshot
  (`plugin/tool-registry-core-tools.ts:51-58`; snapshot frozen at
  `testing/create-plugin-module.ts:220`). omo.json is never re-read during the
  plugin server process lifetime. Editing the JSON mid-session has no effect
  until restart. (Secondary staleness: `config-handler.ts` agentConfigSnapshot
  replay keyed only on opencode-config fields - out of scope, documented.)

### D2 - fallback chain walks wrong-prefix entries
- 2a `delegate-core/src/model-selection.ts:244-263`: cross-provider branch runs
  substring `fuzzyMatchModel(entry.model, allOtherProviders)` - `minimax-m2.7`
  matches `openrouter/minimax-m2.7-highspeed`; any near-name entry under any
  provider wins. No exactness, no registry semantics.
- 2b `features/background-agent/fallback-retry-handler.ts:88-130`: retry rung
  selection checks provider CONNECTIVITY only; a rung whose `provider/model`
  does not exist in the provider-models cache is still dispatched and fails at
  runtime (ProviderModelNotFoundError), one wasted session per bad rung.

### D3 - task terminates COMPLETED with zero assistant output
- `manager.ts validateSessionHasOutput` (2231-2289):
  - `observedOutputSessions` memo set by ANY tool-role message (1637-1639) then
    short-circuits true forever (2232);
  - catch -> `return true` (2284-2288): fetch error counts as valid output;
  - success predicate accepts reasoning/tool-only content - no assistant TEXT
    requirement.
- Polling terminal-status path completes WITHOUT output validation
  (`manager.ts:3045-3047`, status "interrupted").
- Idle-without-output waits forever even when the fallback chain is exhausted -
  no hard failure surfaces.

## Fixes (minimal, TDD RED->GREEN each)

### F1 (D1) fresh config per spawn - delegate-task
- New file `packages/omo-opencode/src/tools/delegate-task/fresh-config-snapshot.ts`:
  `loadFreshConfigSnapshot(directory)` -> `validatePluginConfig(directory)`
  (pure read+parse+transform, confirmed no writes); returns
  `{agents, categories}` or undefined on throw/empty directory.
- `tools.ts execute()`: when `options.directory` is set, attempt fresh read;
  on success build shallow `effectiveOptions = {...options, agentOverrides,
  userCategories, sisyphusJuniorModel}` and use it for resolution + executors;
  on failure log + fall back to boot snapshot (backward compatible; existing
  tests pass no directory).
- RED test (tools.test.ts pattern of #1357 tests): tmp project dir with
  `.omo/omo.json` setting `agents.oracle.model = "test-provider/model-a"`;
  sync spawn -> promptBody.model == model-a; rewrite file to model-b; spawn
  again -> expect model-b (currently returns stale model-a => RED).

### F2a (D2) exact cross-provider match - model-core + delegate-core
- `packages/model-core/src/model-availability.ts`: export
  `findModelIdAcrossProviders(targetModelID, available, excludeProviders?)`:
  candidates from other providers whose normalized model-ID EQUALS the
  normalized target (no substring); shortest full id wins; null otherwise.
- `delegate-core/src/model-selection.ts`: cross-provider branch uses the new
  helper instead of fuzzy `fuzzyMatchModel`. Unresolvable rungs are skipped ->
  chain advances (registry-validated behavior). explicitHigh handling kept.
- RED test (delegate-core/src/model-selection.test.ts):
  availableModels={"openrouter/minimax-m2.7-highspeed","minimax/minimax-m2.7"},
  rung {providers:["gone"],model:"minimax-m2.7"} -> expect
  "minimax/minimax-m2.7"; and with only the -highspeed variant present ->
  expect undefined (skip), currently returns openrouter/-highspeed => RED.

### F2b (D2) cache-validated rung advance - background-agent
- `fallback-retry-handler.ts`: after candidate provider/model computed, if
  `providerModelsCache.models[candidateProviderID]` exists (positive
  knowledge), require canonicalized membership of candidateModelID in cached
  ids (`canonicalizeModelID`: lowercase, dots->dashes); else skip rung + log.
  Cache null or provider absent from cache -> unchanged behavior.
- RED test (fallback-retry-handler.test.ts): cache lists openrouter ->
  ["gpt-5.4-mini-fast"]; rungs [openrouter/qwen3.5-plus (absent),
  openrouter/gpt-5.4-mini-fast] -> expect second rung selected (currently
  first attempted => RED).

### F3 (D3) completion requires deliverable output - background-agent
- `manager.ts validateSessionHasOutput`: drop observedOutputSessions memo
  entirely (Set + markSessionOutputObserved + clearSessionOutputObserved +
  callers at 1637-1639 / 1696); catch -> return false; success predicate =
  at least one assistant message with non-empty TEXT part anywhere in session
  (zero-text sessions can never complete as success).
- Polling terminal-status branch (3045-3047): gate behind
  validateSessionHasOutput; without output -> failCrashedTask with explicit
  message; continue.
- `session-idle-event-handler.ts`: new deps `hasRemainingFallbacks(task)` and
  `failTaskWithoutOutput(task, reason)`; when !hasValidOutput AND no remaining
  fallbacks -> failTaskWithoutOutput (hard failure per issue expectation 3);
  else keep waiting (retry may still land). Manager wires:
  hasRemainingFallbacks = chain && hasMoreFallbacks(chain, attemptCount);
  failTaskWithoutOutput = failCrashedTask with dedicated message.
- RED tests:
  - session-idle-event-handler.test.ts (pure DI): idle + invalid output +
    exhausted chain -> failTaskWithoutOutput called, tryCompleteTask NOT
    called (currently waits silently => RED at manager level; handler test
    pins new contract).
  - manager-level test driving handleEvent/poll with faked client.messages
    returning error-only content -> expect task.status "error", never
    "completed" (follow existing manager.test.ts harness).

## Gates
1. Focused tests x2 clean rounds: delegate-core, model-core (availability),
   background-agent (fallback-retry-handler, session-idle-event-handler,
   manager focused), delegate-task (tools).
2. tsgo --noEmit for touched packages: model-core, delegate-core, omo-opencode.
3. `git diff --check`; hygiene scan: no `as any`/`@ts-ignore`/
   `@ts-expect-error`/non-null `!.` additions.
4. QA: unit/integration fakes over REAL resolution code paths (the RED/GREEN
   tests themselves drive real resolveModelForDelegateTask / tryFallbackRetry /
   idle handler). opencode serve drive under /tmp only if feasible in this env;
   honest blockers stay blockers.

## Evidence
`.omo/evidence/20260826-issue7325-model-fallback-cycle/`: README, plan copy,
RED/GREEN transcripts, gates log, QA verdicts, cleanup receipt.

## Self-audit state machine (post-final-edit)
wave_number=1, clean_streak=0. Each wave: re-read full git diff from disk +
adjacent callers/owners/teardown/error/platform paths; maintain P0-P3+noise
ledger; challenge regression preconditions, RED reasons, false-pass races,
assertion-failure cleanup. Any edit (incl. tests/comments/evidence) resets
clean_streak=0, requires focused tests + typecheck re-run, starts new wave.
Finding wave never counts clean. Stop only after two consecutive
post-final-edit waves with empty ledgers.

## Non-goals / residual risk (documented, not fixed here)
- runtime-fallback hook (reactive session.error system) does not validate its
  config-sourced chain against the catalog either - separate engine, same
  family; flagged for follow-up.
- sync-path `fetchSyncResult` may return earlier-turn text after an empty final
  turn (stale-text scan) - lower severity, sync path already errors on truly
  empty results.
- installer (`cli/model-fallback.ts` ULTIMATE_FALLBACK "opencode/gpt-5-nano")
  writes ghost entries - issue #6799 family, install-time surface.
- config-handler agentConfigSnapshot replay key omits omo.json content (S2) -
  affects only spawns that pass NO explicit model; documented boot-time-only
  surface per issue expectation 1.
