# Plan — issue 6426: architect category unusable on Claude Pro (single-rung chain pinned to plan-gated claude-fable-5)

## Root cause (traced end-to-end, not from memory)

1. `packages/senpi-task/src/category/fallback-chains.ts` defines `architect` with exactly ONE rung:
   `claude-fable-5 xhigh` over `["anthropic","anthropic-api","github-copilot","opencode","vercel"]`.
2. On a Claude Pro subscription the registry still LISTS fable-5 (plan gating happens at request
   time), so the `requiresModel: "claude-fable-5"` activation gate opens and resolution succeeds.
3. `resolveCategory` -> `chainRungCandidates` (model-chain.ts): no rungs exist after index 0, so the
   candidate list is just the selected model; `buildRuntimeModelChain` therefore omits
   `fallback_models` from `ResolvedChildSpec`.
4. `InProcessRunner.start` -> `buildChildSessionOptions` (runners/in-process/child-options.ts:86) ->
   `createRuntimeFallbackSettings(selectedModel, undefined)` ->
   `retry.modelFallback: false` (runtime-fallback-settings.ts:14).
5. The child requests fable-5, Anthropic answers 429 "Usage credits are required for this model",
   and with modelFallback disabled and zero later rungs the child dies. The whole category is dead.

The #6415 quota-dead-rung advancement cannot help: it needs at least one later rung to advance to.

## Fix (minimal, data-only)

Add ONE in-family second rung to the architect chain in
`packages/senpi-task/src/category/fallback-chains.ts`:

```ts
architect: [
  { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"], model: "claude-fable-5", variant: "xhigh" },
  { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"], model: "claude-opus-5", variant: "xhigh" },
],
```

Deliberate deviation from the issue's literal suggestion: we do NOT add the suggested third rung
`gpt-5.6-terra`. Commit 06cc65f3a ("gate architect and ultrabrain on their required models") and
packages/senpi-task/AGENTS.md pin the invariant that gated builtins keep fallback chains trimmed to
their own model family so a cross-family rung cannot bypass the gate via a description-only omo.json
entry (which bypasses `requiresModel`). A terra rung would re-open that bypass. opus-5 is included in
Claude Pro plan limits (issue probe table), so one in-family rung fully restores service.

Behavior preserved:
- Registry WITHOUT fable-5: gate short-circuits before chain fallback -> architect stays
  `model_unavailable` (gating.test.ts contract unchanged).
- Family trim: every architect rung stays a Claude model.

## TDD

RED (new file `packages/senpi-task/src/category/architect-chain-fallback.test.ts`):
1. given registry [anthropic/claude-fable-5, anthropic/claude-opus-5] when resolveCategory("architect")
   then resolved on fable-5 xhigh AND spec.fallback_models defined containing anthropic/claude-opus-5
   xhigh (currently FAILS: fallback_models undefined).
2. chain-shape guard: architect chain has >= 2 rungs and every rung model is Claude-family
   (currently FAILS: length 1). Machine-consumed data pin, not prose.
3. regression guard (passes before+after): registry without fable-5 but with opus-5 keeps architect
   unavailable (gate precedence over chain fallback).

GREEN: apply the chain edit above.

## Gates (twice over identical final tree)

- `bun test packages/senpi-task/src/category packages/senpi-task/src/runners`
- `bun test packages/senpi-task`
- `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json`
- `GIT_MASTER=1 git diff --check`
- hygiene: `GIT_MASTER=1 git grep -n "as any\|@ts-ignore\|console\.log"` on changed paths, zero new hits

## QA (isolated real surface)

- Sandbox root `/tmp/opencode/issue-6426/` with XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_STATE_HOME/
  XDG_CACHE_HOME/HOME pointed inside it; prove isolation before/after (no reads/writes of real
  ~/.omo, ~/.senpi, ~/.config/opencode, ~/.codex, ~/.cache/opencode).
- Drive `bun packages/senpi-task/scripts/manual-category-qa.ts <evidence-dir>` (standalone real-surface
  category QA) plus a focused architect scenario script exercising resolveCategory for the Pro-plan
  shape (fable listed + opus listed) asserting the runtime fallback chain lands in the spec.

## Evidence

`.omo/evidence/20260826-issue6426-architect-claude-pro-chain/`:
README.md, plan.md (this file), red-log.txt, green-log.txt, gates-1.txt, gates-2.txt,
qa-transcript.txt, isolation-proof.txt, cleanup-receipt.md.

## Self-audit state machine

wave_number / clean_streak ledger maintained in README.md; each wave re-reads the full git diff plus
adjacent callers (resolver.ts, model-chain.ts, child-options.ts, runtime-fallback-settings.ts,
gating/dead-chain/resolve-category tests); ANY edit resets clean_streak=0; finish only after two
consecutive post-final-edit zero-finding waves covering P0-P3 + noise.

## Explicitly out of scope

- No commit, no push, no PR (lane mandate).
- No change to model-core CATEGORY_MODEL_REQUIREMENTS (no architect entry exists there; architect is
  senpi-task-only - verified by git grep across packages/omo-opencode).
- No classifier change for plan-gated 429s (advancement machinery already treats quota-class errors
  as advance-worthy; the defect was purely the missing later rung).
