# QA blockers and honest gaps

## Not driven live (and why)

1. **D2 live multi-rung failure chain.** Proving the wrong-prefix walk live
   would require the fake LLM/provider to emit per-model ProviderModelNotFoundError
   responses in a scripted order (fail rung 1, fail rung 2, succeed rung 3) while
   the background manager spawns a new session per rung. The current fake LLM
   emulates happy-path chat + one tool call only. Covered instead by integration
   tests over the REAL `tryFallbackRetry` (fallback-retry-handler.test.ts) and
   the REAL delegate resolver (delegate-core model-selection.test.ts).
2. **D3 live empty-output completion.** Would require driving a child session to
   idle with zero assistant text through the real server plus fallback-exhaustion
   bookkeeping. Covered by manager-level tests that drive the REAL
   BackgroundManager.handleEvent / polling paths with faked client messages
   (manager.test.ts #7325 tests), including the exact "errored assistant +
   stale tool output" message shape from the issue.
3. **runtime-fallback hook (reactive session.error system) not modified.** It can
   also walk config-sourced chains without catalog validation. Out of scope for
   this fix lane (separate engine from the reported spawn path); recorded as
   residual risk and follow-up candidate.

## Environment notes

- Network-restricted env: `bun install` postinstall build hangs past 300s but
  completes its work; killed and re-run per prior lane experience.
- The host machine runs a LIVE opencode+OMO instance writing to the shared
  `/tmp/oh-my-opencode.log`; QA reads of that log were filtered accordingly and
  no host state was modified.
- First live drive accidentally reproduced the #7325 error family
  (`ProviderModelNotFoundError: anthropic/claude-opus-4-8`) when HOME was not
  sandboxed - kept as corroborating evidence in qa-live-drive.md.
