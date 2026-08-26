# RED -> GREEN proofs

All commands run from worktree root. Bun test 1.3.14.

## D2a - cross-provider substring match (delegate-core)

RED test added: `packages/delegate-core/src/model-selection.test.ts`
"#given only a wrong-variant near-name on another provider #when fallback resolves #then the substring rung is skipped (#7325)"

Command: `bun test packages/delegate-core/src/model-selection.test.ts`

RED (before fix):
```
(fail) ... #then the substring rung is skipped (#7325) [0.44ms]
-   "model": "system/default",
+   "model": "openrouter/minimax-m2.7-highspeed",   <- wrong provider + wrong variant via substring match
 10 pass | 1 fail
```
GREEN (after `findModelIdAcrossProviders` in model-core + wiring):
```
11 pass | 0 fail
```
Regression guard also added: exact-id cross-provider match still resolves
("minimax/minimax-m2.7" wins over "openrouter/minimax-m2.7-highspeed").

## D2b - cache-unlisted retry rung dispatched (background-agent)

RED tests added: `packages/omo-opencode/src/features/background-agent/fallback-retry-handler.test.ts`
("#given provider-models cache knows the candidate provider (#7325)" x2)

Command: `bun test packages/omo-opencode/src/features/background-agent/fallback-retry-handler.test.ts`

RED (before fix):
```
(fail) ... skips rungs whose model is absent from the provider catalog ...
(fail) ... returns false when every reachable rung is absent ... Expected: false, Received: true
28 pass | 2 fail
```
GREEN (catalog membership check inside the rung loop):
```
30 pass | 0 fail
```

## D1 - stale config snapshot on spawn (delegate-task)

RED test added: `packages/omo-opencode/src/tools/delegate-task/tools.test.ts`
"re-reads omo.json per spawn so an edited agent model applies without restart (#7325)"
Uses a real temp project dir with a real `.omo/omo.json`, rewritten between spawns.

Command: `bun test packages/omo-opencode/src/tools/delegate-task/tools.test.ts -t "re-reads omo.json per spawn"`

RED (before fix): first spawn already ignored disk config:
```
Expected: {providerID:"test-provider-7325", modelID:"model-a"}
Received: {providerID:"openai", modelID:"gpt-5.5"}   <- fell through to matchedAgent.model; disk never read
```
Mid-state note: after wiring but before hermetic env injection, the host's real
`~/.omo/omo.jsonc` `[opencode]` block leaked into the read (documented in
qa-blockers.md); fixed by the `configEnvironment` test hook (isolated HOME).

GREEN (fresh-config-snapshot.ts + tools.ts effectiveOptions):
```
1 pass | 0 fail
```
Full delegate-task suite: `bun test packages/omo-opencode/src/tools/delegate-task/`
-> 488 pass | 0 fail (both rounds).

## D3 - COMPLETED with empty output (background-agent manager)

RED tests added: `manager.test.ts`
- "fails task instead of completing when idle arrives with no assistant text and fallbacks are exhausted (#7325)"
- "does not complete task when output validation fails to fetch messages (#7325)"

Command: `bun test packages/omo-opencode/src/features/background-agent/manager.test.ts -t "7325"`

RED (before fix):
```
(fail) ... Expected: "error"  Received: "completed"          <- errored session completed as success
(fail) ... Expected: "running" Received: "completed"         <- messages fetch error counted as valid output
0 pass | 2 fail
```
Handler contract RED (`session-idle-event-handler.test.ts`, new deps
hasRemainingFallbacks/failTaskWithoutOutput):
```
(fail) ... #then should fail the task instead of waiting (#7325) - failTaskWithoutOutput not called
15 pass | 1 fail
```
GREEN (validateSessionHasOutput rewrite + memo removal + terminal-status gate +
idle handler hard-failure path):
```
manager.test.ts -t 7325 : 2 pass | 0 fail
session-idle-event-handler.test.ts : 16 pass | 0 fail
full background-agent suite : 749 pass | 0 fail
```

## Test updates forced by intentional behavior changes (not deletions/weakening)

- `parent-wake-part-event-regression.test.ts`: dropped assertions on the REMOVED
  private `observedOutputSessions` set (mechanism deleted; guard holds by
  construction). Primary wake-hold assertions unchanged and green.
- `manager.test.ts` / `manager.polling.test.ts`: two tests pinned the removed
  memo optimization ("completes without fetching messages after output event was
  observed"). Updated to pin the new contract: completion happens only after the
  fresh messages fetch confirms assistant text (messagesCallCount 0 -> 1).
