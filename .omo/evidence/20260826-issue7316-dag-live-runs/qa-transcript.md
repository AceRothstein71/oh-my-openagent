# Senpi QA transcript - issue #7316 dag live-runs

Date: 2026-08-26 (UTC). Surface: senpi DAG runtime (packages/omo-senpi task component +
packages/senpi-task dag engine). Sanctioned live-evidence dir resolved with the skill script:

    node .agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs \
      --repo-root "$(git rev-parse --show-toplevel)" --slug 20260826-issue7316-dag-live-runs
    -> /home/viprix/projects/oom-wt-7316/.omo/evidence/omo-senpi-adapter/20260826-issue7316-dag-live-runs

## What was run

1. `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
   -> `SELF-TEST OK`. The driver + isolation harness itself works; it builds its own isolated
   SENPI_CODING_AGENT_DIR and ignores any caller-provided one.
2. `SENPI_BIN="$(command -v senpi)" bun packages/omo-senpi/scripts/qa/dag-paused-header-qa.ts <ev>/dag-paused-header`
   -> CRASHED before creating any sandbox: `piTui()` barrel accessed before `loadPiTui()`
   (dag-status-row-format.ts:136 -> renderer-text.ts:17 -> lazy/pi-tui.ts:32).
   STASH-VERIFIED PRE-EXISTING: `git stash push` of the 7 changed files + rerun on pristine
   base 8c57e463e produced the identical crash; stash popped cleanly. Not caused by this diff.
3. `command -v senpi` -> absent (exit 1). Per skill rules a missing binary means live drivers
   report SKIP and a SKIP IS NOT A PASS. Recorded here as an honest BLOCKER for live-harness QA.

## Verdicts

- Unit/integration proof of the fixed behavior: PASS. The new adapter tests drive the real
  composition root (`composeTaskEngine` + `createDagRuntime` + FakeExtensionAPI) against real
  on-disk DagFileStores in mkdtemp dirs under /tmp, including real recovery claim/lease writes,
  real journal replay, and the real RPC bridge emission path:
  - cross-session adoption + first-snapshot honesty (dag-runtime.test.ts)
  - same-session attach ordering (dag-runtime.test.ts)
  - adoption mechanics + anti-leak guard (recovery.test.ts)
  - snapshot suspension seam (dag-rpc-bridge.test.ts, 3 new tests)
- Live senpi-binary harness proof: BLOCKED (binary absent in this environment; the DAG-specific
  driver additionally crashes pre-sandbox on a pre-existing pi-tui warm-up defect present on the
  untouched base).

## Isolation proof

- No QA step spawned a senpi engine (binary absent); no driver created a task sandbox
  (the paused-header driver crashed at import/render time, before sandbox creation).
- Real agent dir digest before/after all QA steps (sha256 of every file under ~/.senpi,
  maxdepth 2): UNCHANGED. Digest pair held at /tmp/opencode/senpi-home-digest-{before,after}.txt.
- All test temp trees are mkdtemp dirs under /tmp, removed by afterEach cleanup hooks.

## Omitted / redacted

- No secrets, tokens, or auth material were captured; ~/.senpi/auth.json contents were never
  read, only digested. Driver final JSON is absent because no live driver completed (see verdicts).
