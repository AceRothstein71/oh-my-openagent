# Evidence: issue 6450 - [Senpi][WSL] Config watcher hangs on drvfs projects after updates

Branch: fix/wsl-drvfs-config-watch-6450 (base origin/dev @ 8c57e463e)
Worktree: this repository's worktree root
Date: 2026-08-26

## WHAT WAS TESTED

1. TDD RED: `bun test packages/omo-senpi/src/components/config-watch/paths.test.ts`
   with six new regression tests injected via a `resolveFileSystemType` seam.
   Pre-fix run: the two drvfs tests failed on real assertions (project `.omo`
   and ancestor creation targets were still emitted for a simulated v9fs
   drive; user config targets under a simulated drvfs HOME were still
   emitted). Log: logs/red-paths-test.log (15 pass / 2 fail).
2. GREEN after the guard in paths.ts: 17 pass / 0 fail
   (logs/green-paths-test.log); full config-watch suite 39 pass / 0 fail
   (logs/green-config-watch-suite.log).
3. Gates over the FINAL tree (which additionally carries a one-sentence
   config-watch documentation update in packages/omo-senpi/AGENTS.md), run in
   two consecutive rounds A and B with the tree hash-proven byte-identical
   between them (logs/tree-hash-before-gates.txt == tree-hash-after-gates.txt):
   - focused config-watch suite: 39 pass / 0 fail in BOTH rounds
   - full package suite `bun test packages/omo-senpi`: round B 2274 pass /
     7 skip / 0 fail; round A hit ONE failure outside the touched area
     (task-rpc-launch-parity, senpi-task model admission "confirming re-probe",
     2504 ms) - adjudicated as load-sensitive flake: zero code-path overlap
     with config-watch, passes 5/5 in isolation both WITH the change
     (logs/parity-run1..3.log) and on pristine dev (logs/parity-pristine-run*
     .log), and the same full suite passed twice earlier with the change
     (gates1/gates2-package.log) plus again in round B. Nothing was skipped,
     weakened, or retried to mask it.
   - `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`: exit 0 both rounds
   - `git diff --check`: clean both rounds
   - hygiene grep `as any|@ts-ignore|console\.log` on changed paths: zero hits
4. Extension bundle regenerated with bun 1.4.0 (the CI-pinned version):
   `PATH=<bun-1.4.0> node packages/omo-senpi/plugin/scripts/build-extension.mjs`
   then `--check` reports "extension build is current". The omo.js diff is the
   build marker plus one minified line carrying `statfsSync` and `16914839`
   (logs/omo-js-diff.txt).
5. Isolated real-surface QA (logs/qa-native.log, qa-drvfs.log, qa-tmpfs.log):
   driver at /tmp/opencode/issue-6450/qa-driver.ts drives the REAL component +
   resolver from worktree source under sandboxed HOME/XDG_* env rooted at
   /tmp/opencode/issue-6450/sandbox:
   - native mode: default Linux statfs probe runs against a real ext4 tmpdir;
     full legacy target set survives; wire registration payload keeps id "omo"
     with targets; an all-v9fs injected resolver drops every target and flips
     discovery to reload_required.
   - drvfs mode: real component registered through the injected v9fs resolver
     emits a registration whose targets contain NOTHING under the simulated
     drive root and NO recursive project/ancestor (`/.omo`) targets;
     PLAN9_FILE_SYSTEM_TYPE pinned to exactly 16914839 (not tmpfs 0x01021994).
   - tmpfs mode: default detection probed a REAL different-type mount
     (/dev/shm, statfs type 0x01021994) and correctly did NOT trigger the
     Plan 9 guard, proving the exact-value comparison off the test seam too.

## ISOLATION PROOF

- Driver asserts HOME == <sandbox>/home and XDG_CONFIG_HOME == <sandbox>/config
  before doing anything; QA_SANDBOX must point inside /tmp/opencode/issue-6450/.
- Real-home file-list digest (sha256 of sorted file list under ~/.omo,
  ~/.senpi, ~/.config/opencode, ~/.codex) captured before and after the native
  run: identical ("REAL_HOMES_FILELIST_UNCHANGED:OK" in the transcript).
- No senpi binary exists on this machine (`command -v senpi` empty), so no
  senpi process was spawned and the real senpi agent dir could not be written.

## WHY IT IS ENOUGH

The defect is deterministic target emission, not timing: senpi maps each `dir`
target to a recursive watch, so removing the project/ancestor targets for
Plan 9 cwds removes the blocking traversal by construction. The seam-injected
tests pin exactly which targets disappear and which survive; the tmpfs probe
proves the default detector compares the exact magic on a real alternate
filesystem; the rebuilt bundle is verified fresh against source by the same
`--check` gate CI runs. The full package suite (2274 tests) covers adjacent
surfaces (bundle purity/size/shape, component wiring, rejection retries).

## WHAT WAS OMITTED / REDACTED / NOT VERIFIABLE

- WSL/Plan 9 cannot be reproduced on this machine (no v9fs mount, no WSL).
  The Plan 9 branch is verified ONLY through the injected resolver seam plus
  the exact-magic constant pin. Real drvfs end-to-end behavior (the actual
  unblocking of the TUI) remains reporter-verified only.
- Live Senpi driver QA (scripts/qa/*.mjs) NOT RUN: no `senpi` binary installed.
  Per repo rules a SKIP is not a pass; recorded here as an honest gap. The
  change does not alter any driven surface (task/team/memory), and the
  config-watch protocol payload shape is unchanged for non-Plan-9 hosts.
- `bun run test:senpi` meta-gate not run end-to-end: its build chain would
  regenerate artifacts with local bun 1.3.14 (non-CI toolchain). Equivalent
  pieces were run individually: build-extension.mjs + --check under bun 1.4.0,
  tsgo, and the full package suite.
- Toolchain note (pre-existing, not caused by this lane): rebuilding on
  pristine dev with local bun 1.3.14 churns omo.js/omo-task.js/omo-member.js/
  omo-memory-mcp.js bytes (logs/pristine-build.log), so `build-extension.mjs
  --check` fails on pristine dev in this environment. With CI's bun 1.4.0 the
  rebuild is byte-faithful for every artifact except the intentionally changed
  omo.js, and --check passes.
- Raw logs kept verbatim; nothing secret-bearing was observed or redacted.
