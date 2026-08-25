# 20260824 - Issue #6486: LSP initialize fast-fail timeout

## WHAT WAS TESTED

Surface: `packages/lsp-core` cold start (`LspManager.getClient` path = `client.start()` + `client.initialize()`).

1. Failing-first regression suite `packages/lsp-core/src/lsp/transport-start-fast-fail.test.ts` (5 tests):
   - async spawn death (missing binary) rejects `LspProcessExitedError` < 5s
   - spawned server that consumes the initialize write then exits without responding (`sh -c "sleep 0.5"`) rejects `LspProcessExitedError` < 5s (the faithful #6486 repro)
   - alive-but-silent server (`sleep 30`) rejects `LspStartTimeoutError` naming `OMO_LSP_START_TIMEOUT_MS` < 5s at a 200ms injected deadline
   - responsive echo server (`fixtures/initialize-echo-server.mjs`) still initializes + stops cleanly under an armed guard (non-regression)
   - `resolveStartTimeoutMs()` env parsing (valid / empty / blank / garbage / negative / zero -> default)
2. Env wiring proof: `OMO_LSP_START_TIMEOUT_MS=200 bun test` with NO explicit option bounds a silent server (env-override-wiring.txt).
3. Scoped suite: `bun test packages/lsp-core` (105 pass / 0 fail).
4. Repo gates: `bun run typecheck` (tsgo root + script + all 30 package projects) green.
5. `bun install` was run once; it exits 1 on the pre-existing `prepare` -> `build:materialize` git submodule failure (`packages/shared-skills/upstreams/*`, "Unable to find current revision in submodule path"). Pre-existing/harmless per task brief; dependency linking completed before the failure.

## WHAT WAS OBSERVED

- RED (before fix, red-failing-first.txt): late-exit and silent-server tests both time out at the 10s test ceiling - they were pending on `INIT_TIMEOUT_MS=60_000`. Missing-binary passed pre-fix on Linux only because the stdin write fails fast with EPIPE; that luck does not exist when the write lands in the pipe buffer before the process dies (the late-exit test pins that case deterministically).
- GREEN (after fix, green-after-fix.txt): all 5 pass in ~1.2s total.
- Root cause: `transport.ts` `start()` checked only the synchronous `exitCode` right after spawn; an async spawn failure has not fired yet, so `start()` resolved healthy and the pending `initialize` JSON-RPC request was never rejected on process/stream close (`json-rpc-connection.ts` leaves pendings to their abort timer), blocking the full 60s init ceiling.

## FIX SHAPE

- `constants.ts`: `START_TIMEOUT_MS = 10_000` + `resolveStartTimeoutMs()` reading `OMO_LSP_START_TIMEOUT_MS` (positive integers only, fallback to default).
- `errors.ts`: `LspStartTimeoutError` (names the env var for legitimate slow starters).
- `transport.ts`: `startTimeoutMs` option + `createStartGuard()` - AbortSignal aborted by `proc.exited` (reason `LspProcessExitedError`) or deadline (reason `LspStartTimeoutError`); timer unref'd, disposed after initialize settles.
- `connection.ts`: `initialize()` passes the guard signal into the initialize request; guard disposed in `finally`.
- Manager/reaper untouched; existing `INIT_TIMEOUT_MS` stays as the outer backstop.

## WHY IT IS ENOUGH

Both issue failure modes (async spawn death, hung initialize) are covered by deterministic real-process tests plus a healthy-path non-regression test against a responsive server, and the env override is unit-pinned and integration-proven. The scoped lsp-core suite (105 tests incl. workspace-edit/diagnostics integration suites that perform real cold starts) is green, proving no regression for legit servers; repo-wide tsgo is green. Remaining risk: a legitimately slow-starting server (>10s to answer initialize) now fails fast instead of waiting 60s; mitigation is documented in the error message itself (`OMO_LSP_START_TIMEOUT_MS`).

## WHAT WAS OMITTED

- No live OpenCode/Codex/Senpi harness drive: the change is confined to the harness-neutral `lsp-core` core package (no adapter surface touched), so per task scope the gate is scoped bun tests + typecheck. The MCP consumers (`lsp-tools-mcp`, `lsp-daemon`) inherit the fix through `getClient()` without code changes.
- Raw `bun install` full log beyond the failing tail (env dump noise); only the failure signature retained above.
- No secrets involved; no tokens or credentials appear in any artifact.
