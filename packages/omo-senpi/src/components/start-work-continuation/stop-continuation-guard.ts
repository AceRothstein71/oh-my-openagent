import type { SenpiExtensionAPI } from "../../extension/types"

/**
 * Port of the OpenCode `stop-continuation-guard` (see
 * `packages/omo-opencode/src/hooks/stop-continuation-guard/hook.ts`) for the Senpi adapter.
 *
 * A per-session flag that durably suppresses `start-work-continuation` and `ulw-loop`
 * `agent_end` injections until continuation is explicitly resumed.
 *
 * Semantics (matches the OpenCode reference):
 * - `stop(sessionId)`: mark the session as stopped.
 * - `isStopped(sessionId)`: consulted by `agent_end` handlers to skip continuation injection.
 * - `clear(sessionId)`: called only by an EXPLICIT resume (a `/resume-continuation` slash
 *   command, or a `session_shutdown` cleanup). Ordinary user input MUST NOT clear it —
 *   that was the second half of the bug (see issue #6752).
 *
 * The state model is an in-memory `Set<sessionId>` because the Senpi extension is a
 * single-process TypeScript module; unlike OpenCode we do not need a durable filesystem
 * marker to coordinate multiple processes.
 */
export interface StopContinuationGuard {
  stop(sessionId: string): void
  isStopped(sessionId: string): boolean
  clear(sessionId: string): void
}

export function createStopContinuationGuard(): StopContinuationGuard {
  const stoppedSessions = new Set<string>()
  return {
    stop(sessionId) {
      stoppedSessions.add(sessionId)
    },
    isStopped(sessionId) {
      return stoppedSessions.has(sessionId)
    },
    clear(sessionId) {
      stoppedSessions.delete(sessionId)
    },
  }
}

// Two Senpi components need to share ONE guard for a given extension host: the
// `start-work-continuation` component (which owns the /stop-continuation and
// /resume-continuation commands) and `ulw-loop` (which must also skip its own
// `agent_end` injection while stopped). A per-pi WeakMap gives us that shared handle
// without a global module singleton, so isolated unit tests using their own
// `FakeExtensionAPI` instances stay independent.
const GUARDS = new WeakMap<SenpiExtensionAPI, StopContinuationGuard>()

export function getOrCreateStopContinuationGuard(pi: SenpiExtensionAPI): StopContinuationGuard {
  let guard = GUARDS.get(pi)
  if (guard === undefined) {
    guard = createStopContinuationGuard()
    GUARDS.set(pi, guard)
  }
  return guard
}

export function peekStopContinuationGuard(pi: SenpiExtensionAPI): StopContinuationGuard | undefined {
  return GUARDS.get(pi)
}
