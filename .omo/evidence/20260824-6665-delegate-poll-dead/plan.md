# Plan: issue #6665 - delegate-task poll stalls 30 min on dead subagent

## Root cause (file:line)

`packages/omo-opencode/src/tools/delegate-task/sync-session-poller.ts`

- Completion paths in the poll loop (L101-237):
  1. `getTerminalSessionError` (L185) - only when assistant carries `info.error`.
  2. `isSessionComplete` (L191) - requires `lastAssistant.info.finish` to exist AND not be in `NON_TERMINAL_FINISH_REASONS = {"tool-calls","unknown"}` (`sync-session-turns.ts` L5, L45-46).
  3. Text fallback (L227) - requires `finish` to be MISSING plus assistant text.
- When a subagent stream dies mid-turn, opencode records empty assistant messages with `finish:"unknown"`. Case 2 rejects `"unknown"` forever; case 3 is skipped because a finish value EXISTS. Session status goes idle, transcript freezes, and the only remaining exit is the inactivity timeout (`MAX_POLL_TIME_MS`, default 30 min, `timing.ts` L6) -> parent blocked ~30 min for work that already finished (or can never finish).

## Change (minimal, delegate-task only)

1. `sync-session-turns.ts`: add exported predicate `isStallEligibleTurn(messages)`:
   - last assistant message exists, its `finish` is `undefined` or `"unknown"`, and it has NO pending tool parts (`PENDING_TOOL_PART_TYPES`). Encapsulates the constant locally; conservative: `"tool-calls"` and pending-tool turns stay guarded by the full timeout.
2. `sync-session-poller.ts`:
   - `const DEFAULT_STALL_WINDOW_MS = 30_000` (issue's suggested bounded window).
   - New optional input `stallWindowMs?: number` (mirrors `childWakeGraceMs` pattern; callers unchanged -> default applies).
   - Loop state: `stallObservedSignature` (`${messages.length}:${lastMessageId}`) + `stallStartedAt`.
   - Active-status branch (L167-170): reset stall state (stall measures consecutive inactive observations).
   - After the existing text-fallback branch: if stall-eligible and signature unchanged for `stallWindowMs`:
     - child-continuation gate first (`isAwaitingChildContinuation`);
     - if `hasAssistantText` -> treat complete, `break` (caller fetches deliverable);
     - else `abortSyncSession(..., "stalled_subagent")`, remove toast, return descriptive error naming session ID, window, finish reason.
   - Ineligible turn -> reset stall state.

## Tests (failing first) - `sync-session-poller.stall-detection.test.ts`

House style: bun:test, given/when/then, `require("./sync-session-poller")` at call time, `__setTimingConfig/__resetTimingConfig`, `withMockedDateNow` fake clock (copied file-local from sync-poll-timeout.test.ts).

1. FAILING: finish `"unknown"`, empty parts, idle, frozen -> fails fast with stalled error (not the timeout string), abort called once.
2. FAILING: finish `"unknown"` + substantive text -> resolves `null` (deliverable returned), no abort.
3. Guard: status stays `busy` -> no stall exit; standard inactivity timeout still bounds.
4. Guard: transcript keeps growing -> stall timer resets; timeout remains the bound.
5. Guard: pending tool part + `"unknown"` frozen -> no stall exit.
6. Guard: `"tool-calls"` frozen -> no stall exit.

Expected pre-implementation: 1 and 2 fail (loop runs to inactivity timeout). 3-6 pin conservatism.

## Verification

- `bun test packages/omo-opencode/src/tools/delegate-task/sync-session-poller.stall-detection.test.ts` (failing first, then green)
- Scoped: `bun test packages/omo-opencode/src/tools/delegate-task/`
- `bun run typecheck`
- Evidence recorded in this dir; honest record of any omitted live-harness QA (no provider credentials in env).

## Constraints honored

- Bun-only; no `as any`/`@ts-ignore`/`@ts-expect-error`; no weakened/deleted tests; conventional commit; never stage `packages/shared-skills/upstreams/*`; independent of PR #7186 (different subsystem files).
