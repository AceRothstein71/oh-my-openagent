# QA

## Lane 1 (required bar): integration fakes over the REAL seam - PASS

The 15-scenario suite (`manager.fallback-defer.test.ts`) drives the real
`BackgroundManager` class - real `handleEvent` dispatch, real
`handleSessionErrorEvent`, real `pollRunningTasks`, real `tryFallbackRetry`
(fallback-retry-handler.ts), real `error-classifier` / model-core
`shouldRetryError`, real `session-status-classifier`, real attempt lifecycle -
with fakes only at the OpenCode HTTP client boundary and an injected deferral
scheduler. This is exactly the BackgroundManager+fallback seam named in the
goal, exercised over real code.

Verdict: PASS. Transient errors defer; recovery inside the window skips the
downgrade; grace expiry with a still-failing or dead session takes over;
terminal/quota hard-fails stay immediate; default config is behaviorally
unchanged.

## Lane 2 (optional): isolated live drive under /tmp - PARTIAL, blocker recorded

Setup (all under `/tmp/opencode/qa7319`, isolated XDG_DATA/CONFIG/STATE/CACHE):

- Real `opencode serve` 1.18.23 (`--port 46112`) in the sandbox.
- Fake OpenAI-compatible LLM (`fake-llm.ts`, port 46111) with controllable
  failure modes (`/_control` counters: primaryFailsRemaining).
- Real `BackgroundManager` imported from this worktree's src, constructed with
  `config: { fallbackDeferMs: 5000 }`, SDK client pointed at the sandbox server,
  SSE `/event` stream pumped into `manager.handleEvent`.

### Live result achieved (driver-terminal.log)

Launched a real background task via `manager.launch` against the real server.
OpenCode failed model resolution and emitted a REAL `session.error`
(`ProviderModelNotFoundError: Model not found: fakeprov/primemodel`) through the
real event stream into the real manager. Observed:

- `deferralPending: 0` - the terminal-classified error BYPASSED the grace window
  even though `fallbackDeferMs: 5000` was configured (live proof of the
  hard-fail-immediate invariant).
- Task finalized `status: "error"` with the attempt recorded - prompt error
  finalization intact end-to-end.

### Honest blocker for the full 500-then-success scenario

Driving actual LLM traffic requires opencode to npm-install
`@ai-sdk/openai-compatible` into the sandbox config dir. This environment is
network-restricted: the background dependency install never completed (only a
partial `@ai-sdk/provider` landed; registry unreachable), so opencode cannot
register the custom provider and no chat request can reach the fake LLM
(`/v1/chat/completions` primaryRequests stayed 0). The transient-over-real-HTTP
half of the lane is therefore BLOCKED by environment, not by code; that half
remains covered by Lane 1 scenarios 1-5, 8-12 which simulate exactly those
server behaviors at the client boundary.

## Isolation proof

- Every DB-capable invocation (`opencode serve/run/models`, driver) ran with
  XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_STATE_HOME/XDG_CACHE_HOME pointed at
  `/tmp/opencode/qa7319/xdg/*`. Sandbox DB created and populated there
  (`SANDBOX_DB_PRESENT`; sessions created during QA visible only in sandbox).
- The real `~/.local/share/opencode/opencode.db` was never opened by QA. Its
  large size and per-minute mtime changes come from the user's own pre-existing
  long-running opencode processes (PIDs 6856, 1687169, 1724266, alive before
  this session and unrelated to ports 46111/46112). The only non-sandboxed
  invocations were read-only `opencode --version` / `opencode serve --help`.
- Teardown: fake LLM and sandbox serve killed; ports 46111/46112 verified
  closed (`QA_PORTS_CLOSED`). See cleanup-receipt.md.
