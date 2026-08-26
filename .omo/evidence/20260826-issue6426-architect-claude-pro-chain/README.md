# Evidence — issue 6426: architect category unusable on Claude Pro

Worktree: `/home/viprix/projects/oom-wt-6426` branch `fix/architect-claude-pro-chain-6426` (base origin/dev a17b91cdc).
Lane mandate: no commit, no push, no PR.

## WHAT WAS TESTED

1. TDD RED->GREEN (`red-log.txt`, `green-log.txt`): new co-located suite
   `packages/senpi-task/src/category/architect-chain-fallback.test.ts`. RED failed exactly on the
   defect seams: `spec.fallback_models` undefined for a Pro-shape registry (fable-5 listed +
   opus-5 listed) and architect chain length 1. GREEN after adding one in-family rung.
2. Focused suites: `bun test packages/senpi-task/src/category` (76 pass),
   `packages/senpi-task/src/runners` (162 pass, 1 pre-existing skip), full
   `bun test packages/senpi-task` (1759 pass / 1 skip / 0 fail). Twice (gates-1/gates-2).
3. Strict types: `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json` exit 0. Twice.
4. Real-surface QA (`qa-transcript.txt`, script `/tmp/opencode/issue-6426/architect-qa.ts`):
   drove the REAL `resolveCategory` -> `ResolvedChildSpec.fallback_models` ->
   `createRuntimeFallbackSettings().getRetryFallbackSettings()` seam under a sandboxed
   XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_STATE_HOME/XDG_CACHE_HOME/HOME. 15/15 checks pass:
   Pro-shape registry resolves fable-5 xhigh primary WITH an armed runtime fallback chain
   containing anthropic/claude-opus-5 xhigh (`modelFallback:true`, pre-fix `false`);
   gate precedence preserved (no fable-5 -> unavailable, not listed, no chain-dead details);
   fully-dead Claude family still reports both rungs + missing providers; issue's omo.json
   workaround still bypasses the gate.
5. Sanctioned driver `bun packages/senpi-task/scripts/manual-category-qa.ts`: FAILS at line 157
   ("hardcoded fallback variant is not minimal") - proven PRE-EXISTING by stash-verifying against
   pristine dev (`isolation-proof.txt`); stale quick/luna-fast variant expectation, untouched by
   this change, out of scope.

## WHAT WAS OBSERVED

- Before: single-rung architect chain -> `buildRuntimeModelChain` omits `fallback_models` ->
  `createRuntimeFallbackSettings(selectedModel, undefined)` -> `retry.modelFallback:false` ->
  plan-gated 429 kills every architect child with no advancement.
- After: second Claude-family rung arms both fallback layers: the in-child senpi
  `modelFallback` chain AND the manager-level `task_model_fallback` handoff
  (manager.ts advances `record.fallback_models[0]`, runner-agnostic), plus respawn persistence
  (manager-helpers.ts carries `record.fallback_models` through rebuild).

## WHY IT IS SUFFICIENT

The change is data-only on the exact table both fallback layers consume; the resolver, gate,
viability, chain-candidate, and settings machinery are untouched and fully covered by the
existing 1759-test package suite plus the new behavioral tests. Gate semantics are pinned by
pre-existing tests (gating.test.ts cross-family fixture includes opus-5 and still asserts
architect unavailable) and by the new gate-precedence regression test. Family trim is pinned by
the new chain-shape test (every rung claude-*).

## WHAT WAS OMITTED / REDACTED

- No live Anthropic API call was made (no credentials in sandbox; the 429 itself is upstream
  behavior described in the issue). Advancement-on-429 semantics are owned by the senpi engine's
  retry layer and the manager handoff, both covered by existing suites; this lane proves the
  chain they consume is now populated.
- Issue's suggested third rung (gpt-5.6-terra) deliberately NOT added: violates the gated-category
  family-trim invariant (commit 06cc65f3a, packages/senpi-task/AGENTS.md) - a cross-family rung
  would let a description-only omo.json entry land architect on a non-Claude model.
- Raw env dumps omitted; only dir-level mtimes recorded in isolation-proof.txt (never read or
  wrote real ~/.omo, ~/.senpi, ~/.config/opencode, ~/.codex, ~/.cache/opencode contents).
- `~/.cache/opencode` dir-mtime advanced during the QA window: attributable to the LIVE host
  opencode process streaming this session, not the sandboxed children (their XDG/HOME were
  redirected; bun cache landed inside the sandbox; all other real dirs byte-stable across the window).

## SELF-AUDIT STATE MACHINE

| wave | scope | result | clean_streak |
|------|-------|--------|--------------|
| 1 | full git diff + resolver.ts, builtins.ts, model-chain.ts, manager-helpers.ts, manager.ts handoff, runner.ts toChildSpec, child-options.ts, runtime-fallback-settings.ts(+test), gating/dead-chain/resolve-category/available-categories tests, agents/builtin/fallback-chains.ts, omo-senpi fallback-architect component, AGENTS.md claims | 0 new findings; ledger below adjudicated | 1 |
| 2 | re-read final diff (hash 7ec6061c8c8212447b45bf31336cd4cc unchanged) + gates round 2 over identical tree | 0 findings | 2 -> STOP |

### Findings ledger (P0-P3 + noise, all adjudicated)

- P3 manual-category-qa.ts stale "minimal" variant expectation -> out-of-scope+reason: fails
  identically on pristine dev (stash-verified); quick-chain script drift, separate lane.
- P3 issue-suggested gpt-5.6-terra rung omitted -> documented-no-code: family-trim invariant.
- noise bun-install regenerated tracked dist blobs (omo-codex plugin components, omo-senpi
  extensions, install-dist) -> environmental churn, unstaged, never to be committed.
- noise ~/.cache/opencode mtime drift during QA -> host harness liveness, see above.
- Regression preconditions challenged: gate precedence (PASS), original RED reason (verified in
  red-log), false-pass races (none: pure sync fixtures, no mock.module), assertion-failure
  cleanup (per-test registries, test-setup preload resets).
