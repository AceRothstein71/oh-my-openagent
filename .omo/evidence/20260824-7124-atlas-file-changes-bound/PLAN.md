# Plan: #7124 — Bound atlas FILE CHANGES SUMMARY

## Root cause (file:line)
- `packages/utils/src/git-worktree/format-file-changes.ts:7` — `formatFileChanges()` emits one line per `GitFileStat` with no file-count or byte cap.
- Called from `packages/omo-opencode/src/hooks/atlas/tool-execute-after-subagent-completion.ts:96-97` with stats collected over the ENTIRE verification worktree (`collectGitDiffStatsImpl(verificationDirectory)`), then embedded into `toolOutput.output` at lines 216-235 (`## SUBAGENT WORK COMPLETED`). Large dirty worktree => hundreds of KB injected into parent context after every subagent completion.
- Shim chain: `packages/utils/src/git-worktree/index.ts` -> `packages/omo-opencode/src/shared/git-worktree/format-file-changes.ts` (re-export). Both test files are byte-identical mirrors and must stay in sync.

## Blast radius
- Consumers of `formatFileChanges`: only the two atlas hook files (`tool-execute-after.ts` passes through, `tool-execute-after-subagent-completion.ts` embeds). Hook tests inject mocks; formatter-level tests use real impl via both barrels.

## Changes
1. FAILING TESTS FIRST — add to BOTH mirrors (`packages/utils/src/git-worktree/git-worktree.test.ts`, `packages/omo-opencode/src/shared/git-worktree/git-worktree.test.ts`):
   - given >20 modified files when formatting then caps group with deterministic `...and N more modified files` note and omits overflow paths.
   - given thousands of changed files when formatting then summary <= 32 KiB with explicit `Output truncated: true` marker + total count.
   - given extremely long paths when formatting then byte cap holds and notepad section survives truncation.
2. FIX — `packages/utils/src/git-worktree/format-file-changes.ts`:
   - Constants: `MAX_PATHS_PER_GROUP = 20`, `MAX_SUMMARY_BYTES = 32 * 1024`.
   - Per-group cap: first 20 entries, then `  ...and N more <group> files`.
   - Byte cap over header+group lines only; dropped tail replaced by single note; `[NOTEPAD UPDATED]` block appended after capping so it always survives.
   - Explicit final marker when anything was cut: `Output truncated: true (total changed files: N)`.
3. Verification: scoped `bun test` on utils git-worktree + omo-opencode shared/git-worktree + atlas subagent-completion hook tests; typecheck.

## Not doing (OMITTED)
- Scoping `collectGitDiffStats` to task-specific paths ("preferably" in issue; larger surface).
- Live opencode harness QA drive (opencode-qa skill): time-boxed hotfix; unit + mirror coverage documented instead.
