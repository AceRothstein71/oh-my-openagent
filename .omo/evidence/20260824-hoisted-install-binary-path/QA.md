# QA evidence: hoisted-install Claude native binary resolution (#7063)

Date: 2026-08-24
Branch: issue/7063-hoisted-install-binary-path (base: dev @ 8833800ae)
Scope: packages/omo-native (npm omo-ai launcher: package-paths.js resolver + doctor.js check)

## WHAT WAS TESTED

1. Unit/regression tests (`bun test packages/omo-native/test/package-paths.test.ts`):
   synthetic tempdir installs driven through `resolveClaudeNativeBinary()`:
   - hoisted layout: binary present ONLY at the parent node_modules, senpi has no private
     node_modules -> resolver returns the parent-level path
   - nested layout (bun global): binary under senpi/node_modules -> still resolves first
   - CLAUDE_CODE_EXECUTABLE set to an existing file -> override wins over the engine tree
   - CLAUDE_CODE_EXECUTABLE set to a missing file -> error names the variable and the path
   - binary absent everywhere -> actionable error naming `omo-ai@beta` reinstall and the override
   - linux with only the -musl platform package -> musl candidate reached after glibc misses
2. Doctor integration tests (`bun test packages/omo-native/test/doctor.test.ts`): real launcher
   spawned via `node bin/omo.js doctor` against fixture installs:
   - complete install gains `PASS claude native binary: <path>`
   - missing platform package -> `FAIL claude native binary` + exit 1 + actionable message
   - CLAUDE_CODE_EXECUTABLE env -> PASS reports the override path
3. setup-detect.test.ts launcher fixtures updated with the platform package so the new fail-closed
   check does not flip unrelated exit-code assertions.
4. End-to-end reproduction of the issue layout on the REAL launcher (hermetic prefix under /tmp,
   isolated OMO_CODING_AGENT_DIR + HOME; fixture binaries are dummy files, never executed):
   - Scenario A (e2e-A-hoisted-doctor.txt): npm-hoisted global shape, deps next to omo-ai,
     binary only at `<prefix>/lib/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude`
     -> doctor PASS with exactly that parent-level path, exit 0.
   - Scenario B (e2e-B-missing-fail-closed.txt): same tree without the platform package
     -> `FAIL claude native binary: ... reinstall with: npm i -g omo-ai@beta, or set
     CLAUDE_CODE_EXECUTABLE ...`, exit 1 (fail closed).
   - Scenario C (e2e-C-override-wins.txt): CLAUDE_CODE_EXECUTABLE points at an existing file
     -> PASS reports the override path, exit 0.

## WHAT WAS OBSERVED

- Failing-first: before implementation the new suite failed with
  `SyntaxError: Export named 'resolveClaudeNativeBinary' not found`, and doctor.test.ts failed
  3 cases (no claude line emitted by the old doctor). After implementation: all green.
- Scoped suites: package-paths + doctor + setup-detect = 24 pass / 0 fail.
- Full `bun test packages/omo-native/test`: 133 pass / 6 skip / 1 fail. The single failure is
  `payload.test.ts` ("build:omo-native staged payload") which invokes `build:senpi-plugin` ->
  `materialize-shared-upstreams.mjs --strict` and dies on `git submodule update --init` for
  `packages/shared-skills/upstreams/*`. Proven pre-existing: `git stash -u` on the clean base
  commit reproduces the identical failure (missing submodule objects in this worktree); CI builds
  submodules out-of-band before `bun test`.
- Typecheck: `bunx tsc -p packages/omo-native/tsconfig.json --noEmit` clean.
- Entry smoke: `node packages/omo-native/bin/omo.js --version` ->
  `omo 5.0.0-0.beta.18 (engine: senpi 2026.8.23)`.
- An earlier non-hermetic E2E attempt symlinked the worktree's real senpi into the prefix; Node's
  realpath-based ancestor walk then escaped into the bun store and resolved a real 0.3.238 binary.
  That run was discarded and redone with a fully synthetic senpi copy so Scenario A proves
  parent-level resolution and Scenario B proves fail-closed hermetically.

## WHY IT IS ENOUGH

- The unit suite pins the resolver contract (hoisted parent hit, nested precedence unchanged,
  override precedence, both failure messages) on synthetic trees, so it cannot drift with whatever
  the developer machine has installed.
- The doctor integration tests pin the user-visible surface (PASS line, FAIL + exit code, override).
- The hermetic E2E drives the real `bin/omo.js doctor` entrypoint against the exact directory shape
  from the issue report (npm hoisted global prefix), closing the loop from unit to product surface.
- Remaining risk: platforms/architectures other than linux-x64/darwin-arm64 are covered by the
  shared candidate builder (mirrors senpi's `claudeCodeExecutableCandidates`, including win32 `.exe`
  and musl ordering) but only linux-x64 was exercised live here.

## WHAT WAS OMITTED

- Fixture binary contents are placeholder bytes (`fixture-mach-o`); no binary was executed and no
  Claude SDK network/OAuth flow was driven (requires real credentials; out of scope for a path-
  resolution fix).
- Real macOS hoisted-install verification (the maintainer's outstanding ask on the issue) cannot be
  performed from this Linux environment; the E2E reproduces the layout, not the OS.
- No secrets, tokens, or host paths beyond the local worktree appear in the captured outputs.
