# Evidence: issue #6709 start-work deadlock in apply_patch-only repositories

Date: 2026-08-24
Worktree: /home/viprix/projects/oom-wt-6709
Branch: issue/6709-start-work-apply-patch-only (base dev @ 8833800ae)

## WHAT WAS TESTED

1. Failing-first regression proof for the new machine-consumed contract:
   - `bun test tests/start-work-mutation-capability-contract.test.ts` with
     `packages/shared-skills/skills/start-work/SKILL.md` reverted to base
     (`git checkout -- <file>`), then restored with the fix.
2. Scoped root invariant suite: `bun test tests/*.test.ts`.
3. Full typecheck gate: `bun run typecheck`
   (tsgo root + typecheck:script + typecheck:packages).
4. Codex sync safety: inspected `packages/omo-codex/plugin/scripts/sync-skills.mjs`
   `applyCodexSkillOverlays("start-work", ...)` anchors to confirm the new
   SKILL.md section does not collide with the two exact-string replacements.

## WHAT WAS OBSERVED

1. Base SKILL.md (no contract block): test file errors before running any case -
   "missing start-work-mutation-capability-contract json block" (0 pass / 1 error).
   With the fix restored: 6 pass / 0 fail / 23 expect() calls.
2. Root invariants: 26 pass / 0 fail across 6 files (83 expect calls), including
   the precedent ulw-plan review-convergence contract test (issue #6128 pattern).
3. Typecheck: all three stages completed with no errors.
4. Overlay anchors ("When all top-level checkboxes..." completion text and the
   ultraqa hard-rule bullet list) are disjoint from the inserted section between
   the Phase 3 ultraqa trigger map and "## Phase 4"; sync-skills.mjs replaces by
   exact string, so an additive section cannot break the Codex overlay.

## WHY IT IS ENOUGH

The fix is skill content plus a machine-consumed JSON contract block, per the
issue's suggested direction 1 (plan-level capability contract; harness-neutral,
works for every model/category). The regression test pins only the
machine-consumed contract fields (probe triggers/method, routing flows, broker
author/applier/verbatim/scope/fail-closed/verification, forbidden list) - the
same sanctioned seam as tests/ulw-plan-review-convergence-contract.test.ts - and
errors when the block is absent, which is the failing-first proof. Remaining
risk: the prose around the contract is guidance read by models and has no
automated seam by repo rule (prompt/prose contract tests are forbidden); it is
covered by review. Runtime behavior of live workers is unchanged code-wise
(no TS source touched), so no harness QA surface (opencode/codex/senpi skills)
is triggered by this diff.

## WHAT WAS OMITTED

- Live end-to-end worker spawn against a real apply_patch-only fixture repo:
  requires live model credentials and a spawned harness session; the issue body
  already documents that reproduction (worker tool list without apply_patch,
  BLOCKED_NO_LEGAL_MUTATION_PATH) and this change alters no runtime code path.
- Hashline sandbox suite: unrelated to this markdown-only + test-only change.
- No secrets, tokens, or env dumps were produced or recorded; nothing to redact.
