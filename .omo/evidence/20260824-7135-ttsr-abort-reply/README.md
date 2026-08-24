# Evidence: issue #7135 - TTSR collapse-repetition abort leaves the partial reply, then the nudge rewrites it

Branch: `issue/7135-ttsr-abort-partial-reply` (base dev @8833800ae)

## WHAT WAS TESTED

1. Unit + wiring tests (bun): `packages/omo-senpi/src/components/collapse-recovery/*.test.ts` and `packages/omo-senpi/src/extension/collapse-recovery-wiring.test.ts` drive the component through `FakeExtensionAPI`: detection of the engine's truncated-abort shape (`stopReason: "aborted"`, trailing `[output interrupted by stream rule]` marker block), the `message_end` replacement that shrinks the persisted bubble to the marker alone, the once-per-session hidden `omo-collapse-recovery:context` send without `triggerTurn`, and disarming on user abort / session abort / fresh input.
2. Failing-first proof: with the `component-list.ts` registration stashed, `collapse-recovery-wiring.test.ts` fails 0 pass / 2 fail (`failing-first-wiring.txt`); restored, both pass.
3. Full senpi gate: `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` (clean) and `bun run test:senpi` (2252 pass / 0 fail, 310 files).
4. Live harness e2e: `SENPI_BIN=<workspace>/node_modules/.bin/senpi node packages/omo-senpi/scripts/qa/collapse-recovery-e2e.mjs` drives a REAL senpi process in an isolated sandbox (own HOME/XDG/`SENPI_CODING_AGENT_DIR`, mock provider loaded via `senpi -e`) through a genuine repetition-loop stream so the builtin TTSR detector itself latches and aborts. Assertions cover the persisted session JSONL and the exact provider-visible request log: shrunk bubble persisted, no unshrunk aborted bubble, exactly one TTSR nudge, exactly one hidden recovery context, retry request carried the dedup context plus head/tail excerpts, garbled body absent from the retry.

## WHAT WAS OBSERVED

- Final live run: PASS (`e2e-final.json`): `persistedShrunkBubble: true`, `unshrunkAbortedBubble: false`, `ttsrNudgeCount: 1`, `recoveryContextCount: 1`, `recoveryHidden: true`, `retryCarriedDedupContext/HeadExcerpt/TailExcerpt: true`, `retryStillCariedGarbledBody: false`, `realAgentDirUntouched: true`.
- Session JSONL of a PASS run shows the aborted assistant persisted as content `[ "[output interrupted by stream rule]" ]` only, followed by one hidden `omo-collapse-recovery:context` custom message, the `ttsr-injection` nudge, and a clean retry turn.
- Failing-first wiring run: 0 pass / 2 fail without registration; 26/26 collapse-recovery-related tests pass with it.
- Engine-side verification (source reading, node_modules @code-yeongyu/senpi dist): builtins are unshifted ahead of plugin extensions (`resource-loader.js loadFinalExtensionSet`), so the builtin TTSR `message_end` truncation runs before this component's handler; deferred settle actions flush in registration order (`agent-settled-delivery.js`), so the plain (no-options) context send lands in `agent.state.messages` before the nudge's `triggerTurn` prompt assembles its first provider request (`agent-session.js sendCustomMessage` else-branch).

## WHY IT IS ENOUGH

The unit/wiring layer pins the component contract against the exact engine shapes (marker string, stop reason, result chaining), including negative cases (completed replies, marker-only replies, toolCall-bearing messages, disabled flag). The live driver proves the full product path on the real engine: real detector latch, real abort, real persistence shape, and the retry request contents - the exact UX from the issue (truncated bubble + restated answer) is now one shrunk marker bubble plus one non-repeating retry. Isolation is proven by the sandbox agent dir and `realAgentDirUntouched`. Residual risk: if a future engine release changes the marker text or the settle-delivery ordering, detection/injection timing could drift; the marker constant is pinned by unit tests against the dist value.

## WHAT WAS OMITTED

- Raw senpi stdout/stderr logs from live runs are summarized, not copied verbatim (they contain absolute temp paths and local usernames); the machine-readable final JSON is included instead.
- No real provider credentials are used anywhere; the mock provider is local and keyless, so no secrets needed redaction.
- Not covered: GUI surfaces beyond the persisted session stream (omo-desktop-app rendering), and hosts older than the `message_end` result-chaining release; both would need separate QA lanes.
