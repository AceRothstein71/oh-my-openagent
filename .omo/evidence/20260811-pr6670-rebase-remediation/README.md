# PR #6670 rebase and QA remediation

## Base integration

`feature/omo-profile-cli` was 208 commits behind `origin/dev` and GitHub reported the PR as conflicting. The rebase halted only on `packages/omo-senpi/plugin/extensions/omo.js` and `omo-member.js`. Both generated files were reset to the rebased upstream artifacts, never hand-merged, then recreated by `bun run build:senpi-plugin` and the full `bun run build`. `rebase-conflict.md` and `senpi-rebuild-summary.txt` record that process.

## What was tested

- Focused persisted-profile, profile CLI, and OpenCode validation tests.
- Full `bun run typecheck`, `bun run test:senpi`, root `bun test`, and `bun run build`.
- The `opencode-qa` Case A router in `opencode-profile-qa.sh`, with an isolated XDG/HOME sandbox, a local fake OpenAI provider, and a host session-count receipt.
- The real Senpi `drive.mjs` and `task-e2e.mjs` harnesses with the installed `senpi` binary and their own temporary agent directories.

## What was observed

- The project `active_profile` is ignored with a diagnostic, user selection remains active, and `profile clear` reports the environment-selected profile that remains active.
- `opencode-run-text-event.json` contains the real router response; `session-isolation-proof.txt` shows the host session count stayed `7426 -> 7426`.
- `senpi-task-e2e.json` reports every task lifecycle check and `real_senpi_untouched` as `PASS`. The short drive reports functional `PASS`; its whole-directory digest noticed concurrent host writes, so the task driver's credential-aware isolation verdict is the authoritative Senpi receipt.
- Typecheck, Senpi gate, root Bun suite, and build completed successfully. Summaries are stored alongside the exact commands.

## Local Codex compatibility caveat

`test-codex-local-node22-failure.txt` records an unsuppressed local-only failure in `scripts/check-third-party-notices.mjs`: npm 10.9.2 under the workstation's Node 22.14.0 runs root `prepare` during `npm pack --dry-run --ignore-scripts`, then omits the Codex plugin workspace's `@types/node` before `ulw-loop` builds. The standalone `bun run build` succeeds, the failure does not involve the profile delta, and CI uses Node 24. The required remote Codex compatibility job is therefore the authoritative gate after the lease-safe push.

## Omitted

Fake provider logs contain only the literal `qa-only` test key. Sandbox paths are temporary and removed by the `opencode-qa` EXIT trap or the Senpi drivers. No user credentials or host configuration are captured.
