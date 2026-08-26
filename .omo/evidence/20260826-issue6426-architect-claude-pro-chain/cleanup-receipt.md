# Cleanup receipt — issue 6426 lane

Date: 2026-08-26 (UTC)

## Sandbox

- QA sandbox root: `/tmp/opencode/issue-6426/` (data/config/state/cache/home subdirs + architect-qa.ts).
- All QA processes ran with XDG_DATA_HOME, XDG_CONFIG_HOME, XDG_STATE_HOME, XDG_CACHE_HOME, HOME
  pointed inside that root. Bun's cache landed at `/tmp/opencode/issue-6426/cache/bun` (proof of
  redirection). No real profile directory contents were read or written; only dir-level stat()
  metadata was recorded for before/after proof (`isolation-proof.txt`).
- Sandbox left in place under /tmp/opencode/issue-6426 for reviewer reproduction; disposable.

## Worktree state

- Branch `fix/architect-claude-pro-chain-6426` @ origin/dev a17b91cdc. NOTHING committed,
  NOTHING staged, NO push, NO PR (lane mandate).
- Source changes (unstaged): packages/senpi-task/src/category/fallback-chains.ts (+4),
  packages/senpi-task/src/category/dead-chain.test.ts (+18/-2),
  new file packages/senpi-task/src/category/architect-chain-fallback.test.ts.
- Evidence: `.omo/evidence/20260826-issue6426-architect-claude-pro-chain/` (untracked, intentional).
- Environmental churn from `bun install` postinstall regenerated tracked dist blobs
  (packages/omo-codex/plugin/components/codegraph/dist/*, packages/omo-codex/scripts/install-dist/
  install-local.mjs, packages/omo-senpi/plugin/extensions/*.js). NOT part of this change; left
  unstaged; must never be staged or committed with this work. Reviewers should discard them via
  `git checkout --` on those paths if the worktree is reused.
- `packages/shared-skills/upstreams/*`: untouched (lane mandate honored).
- Anchor checkout and all other worktrees: untouched.
- `git stash` used once for pristine-dev verification (push + immediate pop, verified restored:
  focused suites re-run green afterwards).

## Verification artifacts

red-log.txt, green-log.txt, gates-1.txt, gates-2.txt, qa-transcript.txt, isolation-proof.txt,
final-source.diff, plan.md, README.md (wave ledger), cleanup-receipt.md (this file).
