# QA Evidence — CodeGraph multi-repo consistency (#5588)

Date: 2026-08-25
Branch: issue/5588-codegraph-multirepo-consistency (base c7094b8ac)

## WHAT WAS TESTED

Issue #5588 semantics, both defects:

1. LazyCodex cold-start race: Codex discovers MCP tools while the detached
   SessionStart worker is still bootstrapping, so tools/list can run against an
   uninitialized graph.
   - Fix: serve.ts now awaits initial-graph readiness before spawning the
     bridged `codegraph serve --mcp` child (`src/serve-readiness.ts`).
     Waits only when a fresh per-project bootstrap lock exists; ready means
     exact OR ancestor database present (same probe semantics as the hook);
     bounded by DEFAULT_INITIAL_GRAPH_TIMEOUT_MS=30s, then degrades to serving
     anyway. No lock + no database = immediate serve (previous behavior).

2. Secondary-repository staleness: repositories reached through a tool call's
   projectPath are cached without watchers, so results go stale until a manual
   sync or restart.
   - Fix: mcp-bridge intercepts tools/call requests carrying a projectPath
     outside the serve root and runs a best-effort bounded
     `codegraph sync` (cwd = target project, tree-timeout 30s) before
     forwarding, debounced per canonical path (2s default), serialized per
     path, failures swallowed so tool calls never break.

Commands:
- bun test ./test (component suite)
- bunx tsgo --noEmit -p tsconfig.json
- npm run build (rebuild committed dist/serve.js + dist/cli.js)

## WHAT WAS OBSERVED

- New tests red before implementation (missing modules / assertion failures),
  green after: test/serve-initial-readiness.test.ts (5 cases: ready-immediate,
  idle-no-lock, ready-after-db-appears-under-live-lock, stale-lock-idle,
  timeout-degrade) and test/serve-mcp-bridge-secondary-sync.test.ts (3 cases:
  foreign paths sync once each + debounce + default-root skip with all 5
  requests forwarded and acked; failing sync still forwards; response for the
  first foreign call arrives only after sync completes).
- Full component suite after change: 86 pass / 0 fail across 27 files.
- tsgo --noEmit on the component tsconfig: clean.
- dist rebuilt in the same change (committed artifact policy).

## WHY IT IS ENOUGH

The readiness gate is pinned at the exact seam Codex exercises (serve bridge
startup precedes any tools/list), using the same lock/probe primitives as the
SessionStart hook, so discovery cannot observe an uninitialized graph while a
bootstrap is in flight, and cannot stall when none is. The staleness fix is
pinned at the JSON-RPC forwarding seam with ordering proof (ack after sync),
debounce, default-root exclusion, and failure isolation. Remaining risk: the
upstream `codegraph sync` CLI contract is taken from the issue text ("explicit
sync"); if upstream renames the subcommand the sync degrades to a no-op
failure that never blocks tool calls.

## WHAT WAS OMITTED

No live end-to-end Codex App session was driven (network-restricted
environment; isolated CODEX_HOME install requires network fetches). Coverage
is hermetic unit/bridge-level at the real spawn seams. No secrets or env dumps
in this evidence. The shared-skills/upstreams/designpowers submodule dirt
produced by bun install was left unstaged.
