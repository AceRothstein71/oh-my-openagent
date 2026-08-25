QA Evidence - 20260825 - issue #6268 visual-engineering fallback routes to text-only glm-5.2

Branch: issue/6268-viseng-fallback-text-only-glm (base dev @ c7094b8ac)

## WHAT WAS TESTED

- Surface: hardcoded category fallback chains in packages/model-core/src/category-model-requirements.ts,
  its declared senpi-task mirror (packages/senpi-task/src/category/fallback-chains.ts),
  the co-located pinned routing tests, omo-senpi planner fixtures that resolve
  visual-engineering against those chains, the install CLI help text, and the user-facing
  docs tables describing the visual-engineering chain.
- Command: new structural invariant test
  `bun test packages/model-core/src/vision-category-fallback-invariant.test.ts`
  (offline; reads the repo's own generated snapshot
  packages/omo-opencode/src/generated/model-capabilities.generated.json, no network).
- Fails-before proof: ran the new invariant test on unmodified base sources before any
  source edit (artifact red.txt): both tests fail, pinpointing the glm-5.2 rung.
- Scoped suites after the fix:
  `bun test packages/model-core packages/senpi-task` -> scoped-tests.txt (2100 pass / 1 skip / 0 fail, 280 files)
  `bun test packages/omo-senpi/src/components/task/planner.test.ts` -> 17 pass / 0 fail
- Typecheck: `bun run typecheck` (tsgo --noEmit + script + all workspace packages incl.
  model-core, senpi-task, omo-senpi, omo-opencode) -> exit 0 (typecheck.txt).

## WHAT WAS OBSERVED

- red.txt: 0 pass / 2 fail on base sources. Test 1 flags exactly one text-only rung:
  { providers: [zai-coding-plan, opencode-go, vercel], model: glm-5.2, variant: max }.
  Test 2 fails because the only opencode-go rung in visual-engineering is not
  vision-capable. This is the unit-level reproduction of #6268: an opencode-go user whose
  kimi-k3 rung fails falls through to glm-5.2 (modalities.input = ["text"] per the bundled
  snapshot) for an inherently vision-based category, producing the fixed-error retry loop
  reported in the issue.
- After the fix: every visual-engineering rung accepts image input per the bundled
  snapshot (claude-opus-5, kimi-k3, glm-4.6v, qwen3.7-plus, gpt-5.6-sol), and at least one
  opencode-go rung exists and is vision-capable (qwen3.7-plus, input ["text","image","video"]).
- The replacement pairings follow shipped prior art inside this repo:
  multimodal-looker already pairs zai-coding-plan with glm-4.6v, and explore/librarian
  already pair opencode-go with qwen3.7-plus (agent-model-requirements.ts).
- senpi-task mirror + consumers stay coherent: resolve-category resolves the new Go Qwen
  rung with matchedFallback=true and inherits the category-default variant "max"
  (resolver.ts line 422: userConfig ?? selection ?? config.variant); planner fixtures and
  the manual routing QA script were repointed to models still present in the chain.

## WHY IT IS ENOUGH

- The failing-first invariant locks the issue's expected behavior #1 ("vision categories
  must never resolve through fallback chains to a model without image input") against the
  repo's own capability data, so any future chain edit reintroducing a text-only model in
  visual-engineering fails CI.
- Both touched engines are covered: model-core (OpenCode plugin path) and the senpi-task
  declared mirror (Senpi task engine path), plus the omo-senpi planner consumers of the
  mirror. Docs and CLI help no longer advertise the removed pairing.
- No runtime resolution logic changed - only chain data and its pinned contracts - so the
  unit gates above exercise the full behavioral surface of this change.

## WHAT WAS OMITTED

- Live harness QA (opencode-qa / codex-qa / senpi-qa skills): the change is hardcoded
  chain data + tests + docs; there is no hook/tool/config surface to drive, and real
  provider calls to zai/opencode-go are unavailable offline. The invariant test consumes
  the same generated snapshot the runtime capability lookup uses.
- Agent chains that legitimately keep glm-5.2 as a text-only last resort for general-purpose
  agents (sisyphus, oracle, momus in agent-model-requirements.ts and the senpi-task agent
  mirror): out of scope - #6268 is about the vision-category default; those agents do not
  inherently require image input.
- Issue suggestions (b) circuit-breaker on identical failure signatures and (c) doom-loop
  detection: separate runtime hardening, not part of the default-chain fix requested here.
- bun install prepare-hook submodule failure under packages/shared-skills/upstreams is a
  pre-existing environment limitation (network-restricted worktree); dependency links
  installed fine and no submodule state was staged.
- No secrets appear in any artifact: all outputs are test/typecheck logs.
