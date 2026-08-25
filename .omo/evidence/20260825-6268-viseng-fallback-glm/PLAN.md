# Plan - 20260825 issue #6268 visual-engineering fallback routes to text-only glm-5.2

Worktree: /home/viprix/projects/oom-wt-6268 @ c7094b8ac, branch issue/6268-viseng-fallback-text-only-glm

## ROOT CAUSE

packages/model-core/src/category-model-requirements.ts:16-20 - the visual-engineering
fallback chain rung `{ providers: ["zai-coding-plan", "opencode-go", "vercel"], model: "glm-5.2", variant: "max" }`
pairs opencode-go (and zai-coding-plan/vercel) with glm-5.2, whose input modalities are
`["text"]` only per the repo's own generated snapshot
(packages/omo-opencode/src/generated/model-capabilities.generated.json). visual-engineering
tasks are inherently vision-based, so any user resolving to this rung sends images to a
text-only model and retries forever on the fixed error response (#6268: ~$20 burned).

## FIX (data-level chain edit, mirrors established chain style)

Replace the text-only glm-5.2 rung with two vision-capable rungs, keeping provider priority:

1. claude-opus-5   [anthropic, anthropic-api, github-copilot, opencode, vercel] max   (unchanged)
2. kimi-k3         [kimi-for-coding, moonshotai, opencode-go, opencode, vercel] max   (unchanged)
3. glm-4.6v        [zai-coding-plan, vercel]                                          (NEW shape mirrors multimodal-looker's zai vision rung)
4. qwen3.7-plus    [opencode-go, vercel]                                              (NEW shape mirrors librarian/explore opencode-go pairing)
5. gpt-5.6-sol     [openai, quotio-openai, github-copilot, opencode, vercel] medium   (unchanged)

Both replacements verified image-input-capable in the bundled snapshot
(glm-4.6v / qwen3.7-plus: input ["text","image","video"]) and both pairings already exist
in shipped chains (agent-model-requirements.ts multimodal-looker + explore/librarian).

## FILES

1. NEW packages/model-core/src/vision-category-fallback-invariant.test.ts - failing-first
   invariant: every visual-engineering rung model accepts image input per bundled snapshot;
   every opencode-go rung in the chain is vision-capable and at least one exists.
2. packages/model-core/src/category-model-requirements.ts - the chain fix above.
3. packages/model-core/src/model-requirements-categories.test.ts - update pinned
   "approved 4-rung chain" test to the new approved 5-rung chain (contract update, not weakening).
4. docs/guide/agent-model-matching.md - update the stale visual-engineering table rows.

## VERIFICATION

- RED: new invariant test fails on current sources (glm-5.2 flagged text-only).
- GREEN: scoped `bun test packages/model-core` after fix.
- `bun run typecheck` (or tsgo -p packages/model-core if root gate unavailable).
- Evidence: red.txt / green.txt / scoped-tests.txt / typecheck.txt / qa.md here.
