# Evidence - 20260824 issue #6854 category invisible in TUI

Branch: `issue/6854-category-invisible-tui` (base dev @8833800ae)

## ROOT CAUSE

Category-only delegation (`task(category="quick", ...)`) is forced to
`subagent_type: "sisyphus-junior"` by the PR #1810 mechanism
(`packages/omo-opencode/src/plugin/tool-execute-before.ts:130-141`, verified
intact at dev@8833800ae) so the OpenCode TUI can render a task header. The TUI
header comes from `subagent_type`, and every human-facing string built by the
plugin dropped the category:

- `packages/omo-opencode/src/tools/delegate-task/tool-argument-preparation.ts`
  built `description` (explicit or first-4-prompt-words) without the category
  and published it as the TUI tool-call title via `ctx.metadata({ title })`.
- `packages/omo-opencode/src/tools/delegate-task/background-task-description.ts`
  replaced generated descriptions with `${agent} background task` for
  redaction, dropping the category from background session titles.
- Subagent session titles (`sync-session-creator.ts:21`,
  `features/background-agent/manager.ts:763`) are
  `${description} (@${agent} subagent)` and inherit whatever description carries.

## FIX (display-only, routing untouched)

1. `tool-argument-preparation.ts`: when `category` is present, append
   ` (category: <name>)` to the description. Single chokepoint for sync,
   background, and unstable paths; flows to the parent TUI tool-call title,
   both subagent session titles, job-board/toast titles.
2. `background-task-description.ts`: generated branch keeps the category
   suffix. The category is a validated config key, never prompt-derived, so
   persisting it does not weaken redaction (prompt summaries stay redacted).

Routing (`category` field, forced `subagent_type`, model resolution) is
byte-identical to dev.

## WHAT WAS TESTED

1. Failing-first regression proof - with dev sources (fix stashed concept:
   tests written before the source edits) the new co-located suite fails:
   - New `tool-argument-preparation.test.ts` (3 tests): category-only
     delegation surfaces `(category: quick)` in description + TUI title while
     routing stays `Sisyphus-Junior`; explicit descriptions get the suffix;
     no-category delegations stay byte-identical.
   - Updated pins in `description-redaction.test.ts` (2 tests) expecting the
     category in persisted background descriptions.
   Artifact: `failing-first-on-dev-sources.txt` - 4 fail / 2 pass on dev
   sources (the 2 passes are the no-category guards, correct on both sides).
2. Scoped suite with the fix: `bun test ./packages/omo-opencode/src/tools/delegate-task/ ./packages/omo-opencode/src/plugin/tool-execute-before.test.ts`
   -> artifact `scoped-suite-final.txt`: 509 pass / 0 fail across 44 files.
   Four pre-existing pins that asserted the old category-less strings on
   category-carrying calls were moved to the new intended exact strings
   (`tools.test.ts` x4); all assertions remain exact-equality, none weakened
   or deleted.
3. Typecheck: `bun run typecheck` (tsgo --noEmit + typecheck:script +
   typecheck:packages over all workspace projects) -> exit 0.
   Artifact: `typecheck.txt`.

## WHAT WAS OBSERVED

- On dev sources the issue reproduces in unit form: prepared descriptions and
  metadata titles contain no category for `task(category=...)` calls.
- With the fix, description/title/session-title surfaces carry
  `(category: <name>)` while `subagent_type` stays `Sisyphus-Junior` and the
  `category` arg is unchanged, so routing and runtime-fallback registration
  behave exactly as before.

## WHY IT IS ENOUGH

- Every changed consumer surface has an exact-string regression test that
  fails without the fix and passes with it (failing-first proven against dev
  sources).
- The full delegate-task directory plus the PR #1810 hook test
  (`tool-execute-before.test.ts`) pass unchanged except the four intentional
  pin moves, proving no routing or unrelated behavior drifted.
- Workspace-wide typecheck covers cross-package type safety.

## WHAT WAS OMITTED

- Real-harness TUI drive (opencode-qa skill): tmux is not installed in this
  environment and the operator directive scoped verification to scoped
  `bun test` + typecheck green. The display strings verified here are exactly
  the ones the TUI renders (tool-call title via `ctx.metadata`, session titles
  via `session.create` body), so unit coverage maps 1:1 to the visible surface.
- No secrets in any artifact: test fixtures use sentinel strings only.
