# QA evidence: Windows sweep launcher resolution, spawn powershell.exe ENOENT (#6747)

Date: 2026-08-24
Branch: issue/6747-lsp-daemon-powershell-enoent (base: dev @ 8833800ae)
Scope: packages/utils/src/process-sweep/exec.ts (+ co-located exec.test.ts)

## WHAT WAS TESTED

1. Failing-first regression proof (`failing-first-base.txt`): with the exec.ts fix stashed and
   only the new test present, `bun test packages/utils/src/process-sweep/exec.test.ts` fails on
   the base commit with
   `SyntaxError: Export named 'resolveWindowsSystemBinary' not found` (0 pass / 1 fail).
2. Scoped suite after the fix (`scoped-test-after.txt`): same command, 7 pass / 0 fail:
   - resolveWindowsSystemBinary unit tests (platform-agnostic, injected env + fileExists):
     SystemRoot absolute path wins; windir fallback tree used; missing candidate falls back to
     the bare PATH name; no SystemRoot/windir keeps the bare name.
   - End-to-end enumeration through a fake %SystemRoot% whose System32 carries an executable
     stand-in for powershell.exe: parsed process rows come from the resolved absolute binary.
   - End-to-end kill/terminate through a fake System32 taskkill.exe stand-in: the resolved
     absolute binary runs with `/PID <pid> /T [/F]`.
   - ENOENT annotation: with no SystemRoot and no launcher on PATH, the rejection message names
     the attempted launcher (`"powershell.exe"`) and carries `cause.code === "ENOENT"`, so the
     consumer log line (`lsp-daemon proxy sweep skipped: ...`) in
     packages/omo-opencode/src/shared/omo-process-sweep.ts now shows which binary failed to
     launch instead of a bare `spawn powershell.exe ENOENT undefined`.
3. Full packages/utils Bun suite (`utils-package-suite.txt`): 506 pass / 0 fail.
4. Typecheck (`typecheck.txt`): `tsgo --noEmit -p tsconfig.json` exit 0.
5. `bunx biome check` on both changed files: clean.

## WHAT WAS OBSERVED

- The win32 launchers in exec.ts previously resolved powershell.exe / taskkill.exe through PATH
  only. Under a daemon with a curated or mutated PATH (the #6747 reporter's machine had both
  directories on PATH yet still saw ENOENT from the spawned sweep), the lookup fails and the
  proxy sweep is skipped for the whole session, so orphaned LSP proxies are never reaped.
- After the fix, both launchers prefer `%SystemRoot%\System32\...` (SystemRoot, then windir)
  when that file exists, keeping the bare name as fallback; ENOENT rejections are wrapped with
  the launcher name plus the original error as `cause`.

## WHY IT IS ENOUGH

- The resolver contract is pinned platform-agnostically via injected env/fileExists, so it holds
  regardless of host OS.
- The end-to-end tests drive the real execFile path against executable stand-ins, proving the
  resolved path is actually the one spawned and that arguments are unchanged.
- The annotation test pins the user-visible improvement the issue asked for in point (2).

## WHAT WAS OMITTED

- Live win32 runtime verification is impossible from this Linux host: the end-to-end stand-ins
  are POSIX shell scripts and are gated with `test.skipIf(process.platform === "win32")`
  (the win32 loader cannot execute them). Real-Windows behavior of
  `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` and `%SystemRoot%\System32\taskkill.exe`
  follows the documented layout; CI's windows platform smoke covers the package build but not
  this runtime path.
- No live LSP daemon or OpenCode/Codex session was driven: the change is confined to launcher
  resolution inside packages/utils; the consumer log line was verified by reading the
  interpolation at packages/omo-opencode/src/shared/omo-process-sweep.ts (message text only).
- No secrets, tokens, or private host paths appear in the captured outputs.
