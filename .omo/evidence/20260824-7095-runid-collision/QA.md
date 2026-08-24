# QA Evidence - Issue #7095: reflection bare-runId completion-record collision

Date: 2026-08-24
Branch: `issue/7095-reflection-runid-collision` (worktree `/home/viprix/projects/oom-wt-7095`, base dev @8833800ae)

## WHAT WAS TESTED

Surface: reflection reservation/run-id minting (`packages/memory-core/src/reflection/reservation.ts`,
`packages/omo-senpi/src/components/memory/reflection-run-id.ts`) and its regression coverage.

Commands (bun 1.3.14, hermetic tmpdir fixtures only; no real `~/.senpi/agent`, no network):

1. Failing-first reproduction (scratch test, NOT committed): wired the PRE-FIX per-process counter
   factory (`reflection-run-${++counter}` restarting at 1 per store instance = simulated restart)
   against seeded generation-one debris (`completions/reflection-run-1.json`) and two reserve
   generations across a simulated restart.
   `bun test packages/omo-senpi/src/components/memory/scratch-legacy-counter-repro.test.ts`
2. Fixed behavior, targeted:
   `bun test packages/memory-core/src/reflection/reservation.test.ts`
   `bun test packages/omo-senpi/src/components/memory/reflection-run-id.test.ts packages/omo-senpi/src/components/memory/reflection-run-id-collision.test.ts`
3. Scoped suites:
   `bun test packages/memory-core/src`
   `bun test packages/omo-senpi/src/components/memory`
4. Typechecks:
   `bun run --cwd packages/memory-core typecheck`
   `bun run --cwd packages/omo-senpi typecheck`

## WHAT WAS OBSERVED

1. Failing-first: scratch repro FAILED with exactly the error reported in #7095 -
   `Reflection completion record mismatch for reflection-run-1` thrown at
   `worker/completion-records.ts:15` when the second generation re-minted `reflection-run-1`
   while generation one's consumed completion record was still on disk. Scratch file deleted
   after capture.
2. Targeted after fix: reservation suite 10 pass / 0 fail (includes new async run-id factory
   case minting under the scheduler lock); run-id factory + collision regression suites
   7 pass / 0 fail (fresh ids continue above every persisted id across a simulated restart;
   stale record untouched beside the new one).
3. Scoped suites: memory-core 545 pass / 0 fail (68 files); omo-senpi memory component
   907 pass, 6 skip / 0 fail (135 files).
4. Typechecks: both packages clean.

Isolation proof: all fixtures live under `mkdtemp(tmpdir())`; no command touched the real senpi
agent dir or any harness state. Worktree-only verification; branch never touched `dev`.

## WHY IT IS ENOUGH

The committed regression test (`reflection-run-id-collision.test.ts`) pins the exact reported
wedge end-to-end through the real `ReflectionReservationStore`: stale completion record +
run directory from an earlier generation, then two fresh stores reserving across a restart must
never re-mint a persisted id, and publishing a new completion must leave the stale record
byte-identical. The scratch run proves this test fails against the pre-fix counter behavior with
the issue's literal error string, so it guards the defect, not just the implementation. The
factory unit tests pin disk-scoped high-water semantics (completions, run dirs, live
reservation state, non-run names ignored, strictly increasing within a process). Remaining risk:
ids minted by processes running concurrently on hosts where the scheduler lock is bypassed are
out of scope (the lock is the existing cross-process seam; minting now happens inside it).

## WHAT WAS OMITTED

- Raw bun test output beyond the counts above (no secrets present, trimmed for size).
- The scratch reproduction file itself (deleted from the worktree after capture; its content is
  described above).
- Live Senpi driver QA: this change is exercised hermetically through the real reservation store
  and real filesystem fixtures; no senpi binary surface changed. Not run, and would add no
  coverage of the minted-id contract beyond the suites above.
- Changeset triage note: the crashed session also left an unrelated sandbox-degradation fallback
  changeset (bwrap spawn-failure retry, tracked upstream as #6873) in the worktree. It is
  EXCLUDED from this fix/PR and preserved outside the commit; issue #7095 itself marks Defect 1
  as already covered by #6873.
