# Evidence - issue 6456: omo-senpi ulw-loop inactive because the staged CLI was never resolved

## WHAT WAS TESTED

1. RED->GREEN unit coverage (bun test, packages/omo-senpi):
   - `omo-command.test.ts` new suites: bundled toolkit resolution (staged runtime beside a
     bundle-layout importer wins over a clean env; fall-through to `OMO_BIN` when nothing is
     staged; null when neither staged nor override exists) and child env hygiene (a real spawn
     through `runOmoCommand` sees none of the four session-scoping env keys).
   - `package-shape.test.ts` new test: from the built plugin layout, `resolveOmoBin` with a clean
     env resolves `plugin/runtime/agent-toolkit/cli.js`, and that artifact answers
     `ulw-loop create-goals` + `ulw-loop status --json --session-id pkgshape` under plain node.
2. Session-env isolation (vitest, packages/omo-codex/plugin/components/ulw-loop):
   - Poisoned-env RED run (`CODEX_THREAD_ID=poison-thread CODEX_SESSION_ID=poison-session
     PI_SESSION_ID=poison-pi`) reproduced the issue exactly: 2 failures in
     `cli-checkpoint-continuation.test.ts`, everything else green.
   - After isolating all four keys via `test/session-env-isolation.ts` +
     exported `ULW_LOOP_SESSION_ENV_KEYS`, the same poisoned run passes 40/40.
3. Gates x2 over the identical final tree (gates-round1/, gates-round2/): focused bun test
   (64 pass), focused vitest (40 pass), `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
   exit 0, codex component `tsc --noEmit` exit 0, biome check on changed files clean,
   `git diff --check` clean, hygiene grep zero new hits.
4. Isolated real-surface QA (qa-transcript.log, sandbox under /tmp/opencode/issue-6456/):
   - Installed-layout copy of the staged runtime answered `create-goals` + `status --json`
     with NO session/env help (`ok:true`, one goal) - the issue's acceptance command without
     any Codex installation.
   - Plan-less cwd `status --json` exits 1 with the documented `ULW_LOOP_PLAN_MISSING` JSON
     envelope on stdout (informational behavior check).
   - `probe-cross-session.mjs` end-to-end under bun: verdict PASS - owner session continued
     exactly once, second session zero continuations, host without session identity refused the
     unscoped legacy plan, shared cwd cleaned up.
   - Isolation proof: metadata digests of real `~/.omo`, `~/.senpi`, `~/.codex`,
     `~/.cache/opencode` identical before/after; none exist inside the sandbox HOME.

## WHAT WAS OBSERVED

- Before the fix, `resolveOmoBin()` returned null on a normal local-path install even though the
  compatible pinned CLI shipped inside the same package at `runtime/agent-toolkit/`.
- After the fix, the bundled CLI wins resolution, explicit env overrides still beat PATH
  discovery, and spawned toolkit children can never inherit Codex/PI session scoping.

## WHY IT IS SUFFICIENT

- The package-shape test pins BOTH halves of the production contract: the bundle-relative layout
  rule (`extensions/omo.js` -> `../runtime/agent-toolkit/cli.js`) and the artifact actually
  running. CI's senpi-compatibility job builds the plugin before running this suite, so the
  staged runtime is always present where the gate runs (the pre-existing cross-session probe in
  `index.test.ts` already hard-required it, so no new local-build burden is introduced).
- The poisoned-env vitest run reproduces the exact reported failure mode and proves the fix.
- probe-cross-session drives the REAL component against the REAL staged CLI across two sessions,
  which is the strongest harness-free proof available on this machine.

## WHAT WAS OMITTED / REDACTED

- No live `senpi` binary exists on PATH here, so the optional live extension-load check (observing
  the absence of the "ulw-loop inactive" log inside a real Senpi host) was NOT performed; this is
  recorded as an honest gap rather than claimed.
- Raw status JSON payloads are truncated in the transcript; they contain no secrets (synthetic
  goal text only). Environment dumps are not copied; only key presence was asserted.
- Real home directories were never read beyond path/mtime metadata for the isolation digest.
