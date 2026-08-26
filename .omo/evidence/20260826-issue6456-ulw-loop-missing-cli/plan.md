# Plan - issue 6456: omo-senpi ulw-loop disabled because the required omo CLI is not resolved

## Root cause (traced at HEAD a17b91cdc, not from memory)

The build pipeline ALREADY stages a pinned, self-contained ulw-loop CLI into the built Senpi
plugin package:

- `plugin/scripts/stage-agent-toolkit.mjs` (wired into `build:senpi-plugin` -> `build:senpi-plugin:stage`)
  builds `packages/omo-codex/plugin/components/ulw-loop` into a single bundled `cli.js`, probes its
  self-containment (`node cli.js ulw-loop --help`), and stages
  `packages/omo-senpi/plugin/runtime/agent-toolkit/{cli.js,ulw-loop/cli.js,directive.md,omo-agent-toolkit,omo-agent-toolkit.cmd}`.
- `plugin/package.json` `files` ships `runtime`.

But `packages/omo-senpi/src/components/ulw-loop/omo-command.ts` `resolveOmoBin()` resolves only:
1. `OMO_AGENT_TOOLKIT_BIN` env
2. `omo-agent-toolkit` on PATH
3. `OMO_BIN` env

A normal local-path install of `packages/omo-senpi/plugin` has none of these, so
`createUlwLoopComponent.register()` logs `omo-senpi ulw-loop inactive; omo binary not found`
and disables the durable status/continuation bridge even though a compatible pinned CLI ships
inside the very same package directory tree.

Secondary defect (issue "Additional Session-Isolation Issue"): the toolkit scopes state/evidence
by env (`OMO_ULW_LOOP_SESSION_ID`, `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, `PI_SESSION_ID`,
`packages/omo-codex/plugin/components/ulw-loop/src/paths.ts`). Seven component test files clear
only `OMO_ULW_LOOP_SESSION_ID`, so inherited `CODEX_THREAD_ID`/`CODEX_SESSION_ID`/`PI_SESSION_ID`
(e.g. running the suite inside Codex Desktop) re-scope session dirs and fail checkpoint tests.
The senpi adapter also spawns the toolkit with the host env verbatim.

## Fix design

1. `omo-command.ts`:
   - Add `resolveBundledToolkitCli(importerUrl = import.meta.url)`: resolve
     `<importerDir>/../runtime/agent-toolkit/cli.js`; return the absolute path when it is a
     regular file, else null. Same `import.meta.url`-relative pattern as the shipped lsp
     packaged-runtime resolver (`src/components/lsp/daemon-runtime.ts`); after bundling,
     `import.meta.url` points at `plugin/extensions/omo.js`, so the relative layout holds in
     production and in dev-source contexts it harmlessly misses.
   - `resolveOmoBin(env = process.env, importerUrl = import.meta.url)` precedence: bundled staged
     runtime FIRST (pinned to this build; issue demands bundled before OMO_BIN/PATH), then
     `OMO_AGENT_TOOLKIT_BIN`, then PATH `omo-agent-toolkit`, then `OMO_BIN`. The deliberate
     no-bare-`omo` rule stays unchanged.
   - `runOmoCommand` strips all four session-scoping env keys from the spawned child env: the
     adapter always passes `--session-id` explicitly, and an inherited Codex thread id must never
     be able to scope toolkit state if any path ever omits the flag.
2. Package-shape coverage (`src/package-shape.test.ts`): given the built plugin layout, resolve
   the bin through `resolveOmoBin` with a plugin-layout importer URL and a clean env, then run
   `create-goals` + `status --json --session-id ...` from the staged artifact under plain node in
   a temp cwd with sanitized env - proving the issue's acceptance command works with no Codex
   installation and no env help.
3. Session-env isolation: export `ULW_LOOP_SESSION_ENV_KEYS` from codex `paths.ts`; update the 7
   test files to save/clear/restore ALL four keys; add `PI_SESSION_ID` to
   `cli-entrypoint.test.ts` `sanitizedEnv()`.

## TDD order

1. RED: new senpi tests (bundled resolution via fixture tree, precedence, child-env sanitization,
   package-shape live run) -> capture failing log.
2. GREEN: implement omo-command.ts changes; stage runtime via
   `node packages/omo-senpi/plugin/scripts/stage-agent-toolkit.mjs`; capture passing log.
3. RED: run the 7 codex vitest files with `CODEX_THREAD_ID`/`PI_SESSION_ID` poisoned ->
   capture failures; GREEN: apply isolation edits; rerun poisoned -> pass.
4. Gates x2 over identical final tree: focused bun test (senpi ulw-loop dir + package-shape),
   focused vitest (7 files), `tsgo --noEmit` for both touched packages, `git diff --check`,
   hygiene grep on changed paths.
5. Isolated QA under /tmp/opencode/issue-6456/: sandboxed XDG/HOME env; prove the built plugin
   package answers `omo ulw-loop status --json` without Codex; run probe-cross-session.mjs
   end-to-end; prove real ~/.omo, ~/.senpi, ~/.codex untouched.

## Constraints honored

- No commit / push / PR. No touching packages/shared-skills/upstreams/*. No weakening tests.
- No `as any` / `@ts-ignore` / non-null assertions; given/when/then; kebab-case; no emojis.
- rg unavailable -> GIT_MASTER=1 git grep. LSP daemon down -> tsgo is the diagnostics gate.
