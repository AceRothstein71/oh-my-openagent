# Evidence: #7124 atlas FILE CHANGES SUMMARY bound

## WHAT WAS TESTED

- `bun test packages/utils/src/git-worktree/ packages/omo-opencode/src/shared/git-worktree/` — formatter unit + mirror suites through both barrels (`@oh-my-opencode/utils` real impl and the `packages/omo-opencode/src/shared/git-worktree` re-export shim).
- New failing-first regression tests (added BEFORE the fix, confirmed red):
  1. given >20 files in one group when formatting then group capped at 20 with deterministic `...and 5 more modified files` note, overflow paths omitted.
  2. given 6500 changed files when formatting then serialized summary <= 32 KiB with explicit `Output truncated: true` marker carrying total count.
  3. given ~2000-char paths exceeding the byte cap when formatting then byte cap holds AND `[NOTEPAD UPDATED]` block survives truncation.
- Consumer hook suites unchanged behavior: `bun test packages/omo-opencode/src/hooks/atlas/tool-execute-after-subagent-completion.test.ts tool-execute-after-task-timers.test.ts tool-execute-after-background-launch.test.ts`.
- `bun run typecheck` (tsgo root + script + all workspace packages).

## WHAT WAS OBSERVED

- RED (before fix): new tests failed — unbounded summary was 60,749 bytes for the long-path fixture (> 32 KiB), no per-group cap (`src/modified_20.ts` present), no truncation marker. Existing 6 formatter tests kept passing before and after.
- GREEN (after fix): 33 pass / 0 fail across both mirror dirs (103 expect calls); atlas consumer suites 27 pass / 0 fail; typecheck green end-to-end.
- Fix shape: per-group cap of 20 paths with deterministic `...and N more <modified|created|deleted> files` notes; 32 KiB byte cap over header+group lines with a `...summary truncated at 32768 bytes` note; final `Output truncated: true (total changed files: N)` marker whenever anything was cut; `[NOTEPAD UPDATED]` block appended after capping so it always survives.

## WHY IT IS ENOUGH

- The issue's failure mode is the serialized summary growing without limit; the regression tests pin the exact invariant at the only seam that produces the string (`formatFileChanges`), exercised through BOTH import paths used in production (utils barrel + adapter shim mirror, kept byte-identical).
- Caps are deterministic (stable input order -> stable output), so the truncation note is reproducible for reviewers.
- Consumer hooks inject `formatFileChanges` as a dependency; their suites prove wiring is untouched, and the real implementation they receive is now bounded regardless of how many stats `collectGitDiffStats` returns.

## WHAT WAS OMITTED

- Scoping `collectGitDiffStats` enumeration to task-specific paths/worktrees (issue lists it as "preferably"): larger surface touching collection semantics; the required outcome (bounded summary) is fully covered. Collection cost itself is unchanged.
- Live opencode harness drive via the `opencode-qa` skill (SSE hook probe / TUI smoke): time-boxed hotfix window; the changed surface is a pure string formatter covered by unit + mirror suites, and the hook-level composition is pinned by existing injected-dependency tests. No secrets, tokens, env dumps, or private logs are included in this evidence.
