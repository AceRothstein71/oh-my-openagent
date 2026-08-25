# QA Evidence — fix(lsp): plumb session directory into LSP request context (#6207)

Date: 2026-08-25
Branch: issue/6207-lsp-cwd-file-reject (base c7094b8ac)
Worktree: /home/viprix/projects/oom-wt-6207

## WHAT WAS TESTED

Surface: `@oh-my-opencode/lsp-core` request-context resolution + the standalone LSP MCP stdio entry, and the OpenCode adapter's built-in `lsp` MCP config emission.

- Issue #6207: with `opencode web` launched from `$HOME`, every `lsp_*` call for a session whose project lives outside `$HOME` failed with "LSP file path must be inside request cwd", because `createStandaloneMcpRequestContext()` defaulted the context cwd to the server process cwd and no channel carried the session directory.

Commands:
- `bun test packages/lsp-core/src/request-context.test.ts packages/lsp-core/src/mcp-stdio-cwd.test.ts packages/omo-opencode/src/mcp/lsp.test.ts` (failing-first run: 2 new-context tests red before the fix — env override ignored, containment error returned; all green after)
- `bun test packages/lsp-core` → 103 pass / 0 fail
- `bun test packages/omo-opencode/src/mcp` → 43 pass / 0 fail
- `bunx tsgo --noEmit -p packages/lsp-core/tsconfig.json` → clean
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` → exit 0

## WHAT WAS OBSERVED

Before fix (red):
- `request-context.test.ts` new test: context cwd resolved to process cwd (`/home/viprix/projects/oom-wt-6207`) despite `LSP_TOOLS_MCP_CWD` pointing at a temp session dir.
- `mcp-stdio-cwd.test.ts`: `tools/call lsp_prepare_rename` over stdio with a file inside the session dir returned "must be inside request cwd".

After fix (green):
- Precedence is explicit input cwd > `LSP_TOOLS_MCP_CWD` env > `process.cwd()`; explicit input still wins (pinned by test).
- End-to-end stdio drive of `runMcpStdioServer()` with `LSP_TOOLS_MCP_CWD=<session dir>` no longer returns the containment error for files inside the session dir.
- `createLspMcpConfig()` now emits `LSP_TOOLS_MCP_CWD: <session directory>` so both the daemon proxy and any standalone server child inherit the session directory that OpenCode's config hook provided (`ctx.directory`).

Isolation: tests use only mkdtemp dirs under tmpdir/homedir; no real user config read (`env` injected explicitly in unit tests); no daemon or language server spawned; no network access. Repo state: only the four intended source/test files modified plus this evidence file; submodule noise (`packages/shared-skills/upstreams/designpowers`) left untouched and unstaged.

## WHY IT IS ENOUGH

The failing-first pair pins both halves of the plumbing: the context-resolution seam (unit) and the real stdio server behavior driven through `runMcpStdioServer()` (integration), plus the adapter-side emission pin. The daemon proxy consumes the same `createStandaloneMcpRequestContext()`, so it inherits the override without code change; its existing inference still takes precedence via explicit `input.cwd`. Remaining risk: harnesses that spawn the standalone server without setting `LSP_TOOLS_MCP_CWD` keep the old process-cwd default — unchanged behavior, documented in-code.

## WHAT WAS OMITTED

No secrets, tokens, or env dumps involved; nothing to redact. Full `bun run typecheck` and live `opencode web` multi-session drive were not run in this environment (offline install; hard timebox) — scoped package typechecks + full lsp-core suite are recorded above instead.
