# Cleanup receipt - issue 6456 QA

- Sandbox root: /tmp/opencode/issue-6456/ (sandbox home + XDG dirs, installed-layout runtime copy,
  qa-run.sh driver, probe JSON output). Left in place as reproducible QA material; contains only
  synthetic data and can be deleted safely.
- Shared QA cwds created by probe-cross-session.mjs: removed by the probe itself
  (`cleanup.removedSharedCwd: true` observed in qa-transcript.log).
- package-shape test workspace (mkdtemp under os.tmpdir): removed by the test's finally block.
- omo-command.test.ts child-env probe: no filesystem residue (env-only child).
- Real `~/.omo`, `~/.senpi`, `~/.codex`, `~/.cache/opencode`: never written; metadata digests
  identical before/after (see README.md isolation proof).
- Worktree state: no commits made; all changes unstaged on fix/ulw-loop-missing-cli-6456;
  unrelated build-output churn from staging (codegraph dist, install-local.mjs, senpi extension
  bundles) was reverted via git checkout -- so the diff contains only intended files.
