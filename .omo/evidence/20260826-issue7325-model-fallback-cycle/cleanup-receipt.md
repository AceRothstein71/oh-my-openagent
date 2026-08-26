# Cleanup receipt

## Transient artifacts removed
- Fake LLM server (`/tmp/opencode/qa7325/fake-llm.ts` process): stopped; port 45725 free.
- `opencode serve` QA instance: stopped.
- QA sandboxes `/tmp/omo-qa-sandbox.*` (XDG + HOME + project fixtures + sandbox DBs): deleted.
- Postinstall-build dirt in generated files (omo-codex codegraph dist bundles,
  install-local.mjs, omo-senpi plugin extensions) restored via
  `git checkout --` after each rebuild; final tree shows ZERO generated-file dirt.
- Debug scratch files under /tmp/opencode/ (repro/dbg scripts) remain outside the
  repo and are inert; QA driver artifacts kept under /tmp/opencode/qa7325/ as
  referenced evidence copies.

## Final dirty-tree inventory (reviewer-ready, NO commits made)
Modified (16):
- packages/delegate-core/src/model-selection.ts (+ test)
- packages/model-core/src/index.ts, model-availability.ts
- packages/omo-opencode/src/features/background-agent/{fallback-retry-handler,
  manager, session-idle-event-handler}.ts (+ 5 co-located test files)
- packages/omo-opencode/src/plugin/tool-registry-team-tools.ts
- packages/omo-opencode/src/tools/delegate-task/{tools.ts, types.ts} (+ tools.test.ts)
Untracked new source file (1):
- packages/omo-opencode/src/tools/delegate-task/fresh-config-snapshot.ts
Evidence + plan (gitignored paths, written to disk per repo contract):
- .omo/plans/2026-08-26-issue-7325-subagent-model-fallback.md
- .omo/evidence/20260826-issue7325-model-fallback-cycle/* (7 files)

## State machine stop condition
wave_number=3, clean_streak=2 (waves 2 and 3 post-final-edit with empty
actionable ledgers). Gates re-run clean after the last edit: focused suites
1605 pass / 0 fail x2 rounds; tsgo OK for omo-opencode, delegate-core,
model-core; git diff --check clean; hygiene scan zero suppressions and zero
non-null assertions added.
