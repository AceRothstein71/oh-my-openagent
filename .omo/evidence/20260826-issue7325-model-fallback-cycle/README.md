# Evidence: issue #7325 - subagent model config ignored, wrong-prefix fallback chain, COMPLETED with empty output

Date: 2026-08-26 | Worktree: /home/viprix/projects/oom-wt-7325 | Branch: fix/7325-subagent-model-fallback-cycle | Base: 8c57e463e

## WHAT WAS TESTED (per file in this dir)

| File | Content |
|------|---------|
| `plan.md` | Copy of the pre-edit implementation plan (.omo/plans/2026-08-26-issue-7325-subagent-model-fallback.md) |
| `red-green.md` | Per-defect RED failure transcripts + GREEN passes, exact commands |
| `gates.md` | Focused test rounds x2, tsgo per touched package, git diff --check, hygiene scan |
| `qa-live-drive.md` | Real opencode 1.18.23 serve-mode drive with worktree plugin + fake LLM; mid-session config edit proof; isolation proof |
| `qa-blockers.md` | What was NOT driven live and why |
| `self-audit-ledger.md` | Wave state machine: wave_number, clean_streak, P0-P3+noise findings |
| `cleanup-receipt.md` | Transient artifacts removed; final dirty-tree inventory |

## SUMMARY OF ROOT CAUSES x3

1. **D1 (configured models ignored/stale)**: delegate-task tool closure captured
   `agents`/`categories` from the boot-time pluginConfig snapshot
   (`tool-registry-core-tools.ts:51-58`, snapshot frozen at
   `create-plugin-module.ts:220`); omo.json never re-read during process lifetime.
2. **D2 (wrong-prefix fallback chain)**: (a) delegate-core cross-provider branch
   used substring `fuzzyMatchModel` across all providers - near-name variants on
   wrong providers won (`model-selection.ts:244-263`); (b) background retry rung
   selection validated provider connectivity only, never that the model exists in
   the provider catalog (`fallback-retry-handler.ts:88-130`).
3. **D3 (COMPLETED with empty output)**: `validateSessionHasOutput`
   short-circuited on a memo set by ANY tool-role message, returned true on fetch
   error, accepted reasoning/tool-only content as success; polling terminal-status
   path completed without any validation; idle-without-output waited forever even
   with the fallback chain exhausted.

## FIXES (diffstat at time of evidence)

15 modified files + 1 new file; 463 insertions / 98 deletions (see gates.md for
exact diffstat). No commits made - reviewer-ready dirty tree per task contract.

## VERDICTS

- D1: FIXED, proven live (mid-session config edit honored on next spawn, same server).
- D2a: FIXED (exact model-ID cross-provider matching; unresolvable rungs skipped).
- D2b: FIXED (retry rungs validated against provider-models cache when it knows the provider).
- D3: FIXED (completion requires assistant text; fetch errors no longer count as output;
  terminal-status gate; exhausted-chain idle surfaces hard ERROR).
