# Cleanup receipt

## Temporary artifacts

- /tmp/opencode/issue-6450/ - QA driver, sandbox, logs. Sandbox removed and
  recreated per run (`rm -rf` before each mode); final copies of all logs are
  archived under logs/ in this evidence directory. The directory itself is
  left in place as the lane's mandated QA workspace.
- /tmp/opencode/bun-1.4.0/ - CI-version bun binary downloaded solely to
  regenerate the extension bundle with the CI-pinned toolchain. Left in /tmp;
  nothing outside it was modified by it.
- /tmp/opencode/issue-6450/sandbox - isolated HOME/XDG sandbox used by the QA
  driver; contains only fixtures created during this QA.

## Worktree state

- Branch fix/wsl-drvfs-config-watch-6450; exactly three modified files:
  packages/omo-senpi/src/components/config-watch/paths.ts
  packages/omo-senpi/src/components/config-watch/paths.test.ts
  packages/omo-senpi/plugin/extensions/omo.js (regenerated artifact)
- No commits made (lane mandate). No pushes. No PR.
- Out-of-scope rebuild churn (omo-task.js, omo-member.js, omo-memory-mcp.js,
  omo-codex codegraph dist, install-dist) was reverted to committed state.
- No submodule paths touched; packages/shared-skills/upstreams untouched.
- Real user surfaces (~/.omo, ~/.senpi, ~/.config/opencode, ~/.codex) verified
  untouched via before/after file-list digests.
