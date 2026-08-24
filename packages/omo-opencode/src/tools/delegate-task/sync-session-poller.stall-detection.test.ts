declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import { __setTimingConfig, __resetTimingConfig } from "./timing"

function createMockCtx(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "test-agent",
    abort: controller.signal,
  }
}

async function withMockedDateNow(stepMs: number, run: () => Promise<void>) {
  const originalDateNow = Date.now
  let now = 0

  Date.now = () => {
    const current = now
    now += stepMs
    return current
  }

  try {
    await run()
  } finally {
    Date.now = originalDateNow
  }
}

function createIdleStatusClient(sessionID: string, messagesFn: () => Promise<{ data: unknown }>, onAbort?: () => void) {
  return {
    session: {
      abort: async () => {
        onAbort?.()
      },
      messages: messagesFn,
      status: async () => ({ data: { [sessionID]: { type: "idle" } } }),
    },
  }
}

describe("pollSyncSession stall detection (#6665)", () => {
  beforeEach(() => {
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 5000,
    })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  describe("#given an idle session whose last assistant message has finish \"unknown\" and no deliverable", () => {
    describe("#when the transcript stays frozen past the stall window", () => {
      test("#then the poll fails fast with a stalled-subagent error instead of the inactivity timeout", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        let abortCount = 0
        const mockClient = createIdleStatusClient(
          "ses_stall",
          async () => ({
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
              {
                info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" },
                parts: [],
              },
            ],
          }),
          () => {
            abortCount++
          },
        )

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_stall",
            agentToUse: "oracle",
            toastManager: null,
            taskId: undefined,
            stallWindowMs: 50,
          })
        })

        // then: resolved via the stall path, not the 30-min/5s inactivity timeout
        expect(result).toContain("stalled")
        expect(result).toContain("ses_stall")
        expect(result).not.toContain("Poll inactivity timeout reached")
        expect(abortCount).toBe(1)
      })
    })
  })

  describe("#given finish \"unknown\" but a substantive text deliverable exists", () => {
    describe("#when the transcript stays frozen past the stall window", () => {
      test("#then the poll resolves as complete and returns the deliverable path (null)", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        let abortCount = 0
        const mockClient = createIdleStatusClient(
          "ses_deliverable",
          async () => ({
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
              {
                info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" },
                parts: [{ type: "text", text: "The final answer is 42" }],
              },
            ],
          }),
          () => {
            abortCount++
          },
        )

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_deliverable",
            agentToUse: "oracle",
            toastManager: null,
            taskId: undefined,
            stallWindowMs: 50,
          })
        })

        // then
        expect(result).toBeNull()
        expect(abortCount).toBe(0)
      })
    })
  })

  describe("#given the session status stays active over multiple frozen polls", () => {
    describe("#when the transcript is frozen with finish \"unknown\" while status is busy", () => {
      test("#then no stall exit occurs while active and a later terminal finish still completes normally", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        let abortCount = 0
        let statusCallCount = 0
        const mockClient = {
          session: {
            abort: async () => {
              abortCount++
            },
            messages: async () => ({
              data: [
                { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                {
                  info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" },
                  parts: [],
                },
                {
                  info: { id: "msg_003", role: "assistant", time: { created: 9000 }, finish: "stop" },
                  parts: [{ type: "text", text: "Recovered and finished" }],
                },
              ],
            }),
            status: async () => {
              statusCallCount++
              return { data: { ses_busy: { type: statusCallCount <= 5 ? "busy" : "idle" } } }
            },
          },
        }

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(1000, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_busy",
            agentToUse: "oracle",
            toastManager: null,
            taskId: undefined,
            stallWindowMs: 1,
          })
        })

        // then: kept polling through the busy phase (stall suppressed) and completed on the terminal finish
        expect(statusCallCount).toBeGreaterThanOrEqual(6)
        expect(result).toBeNull()
        expect(abortCount).toBe(0)
      })
    })
  })

  describe("#given new messages keep arriving with non-terminal finish reasons", () => {
    describe("#when each poll observes a grown transcript", () => {
      test("#then the stall timer resets on every change and the inactivity timeout remains the bound", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        let abortCount = 0
        let callCount = 0
        const mockClient = createIdleStatusClient(
          "ses_growing",
          async () => {
            callCount++
            const messages: unknown[] = [{ info: { id: "msg_000", role: "user", time: { created: 0 } } }]
            for (let i = 1; i <= callCount; i++) {
              messages.push({
                info: { id: `msg_${String(i).padStart(3, "0")}`, role: "assistant", time: { created: i }, finish: "unknown" },
                parts: [],
              })
            }
            return { data: messages }
          },
          () => {
            abortCount++
          },
        )

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_growing",
            agentToUse: "oracle",
            toastManager: null,
            taskId: undefined,
            stallWindowMs: 50,
          })
        })

        // then
        expect(result).toContain("Poll inactivity timeout reached")
        expect(abortCount).toBe(1)
      })
    })
  })

  describe("#given the last assistant message has pending tool parts with finish \"unknown\"", () => {
    describe("#when the transcript stays frozen past the stall window", () => {
      test("#then no stall exit occurs because tools may still be running", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        let abortCount = 0
        const mockClient = createIdleStatusClient(
          "ses_tools",
          async () => ({
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
              {
                info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" },
                parts: [{ type: "tool", text: "" }],
              },
            ],
          }),
          () => {
            abortCount++
          },
        )

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_tools",
            agentToUse: "oracle",
            toastManager: null,
            taskId: undefined,
            stallWindowMs: 50,
          })
        })

        // then
        expect(result).toContain("Poll inactivity timeout reached")
        expect(abortCount).toBe(1)
      })
    })
  })

  describe("#given the last assistant message has finish \"tool-calls\"", () => {
    describe("#when the transcript stays frozen past the stall window", () => {
      test("#then no stall exit occurs because tool-calls stays guarded by the full timeout", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        let abortCount = 0
        const mockClient = createIdleStatusClient(
          "ses_toolcalls",
          async () => ({
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
              {
                info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "tool-calls" },
                parts: [],
              },
            ],
          }),
          () => {
            abortCount++
          },
        )

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_toolcalls",
            agentToUse: "oracle",
            toastManager: null,
            taskId: undefined,
            stallWindowMs: 50,
          })
        })

        // then
        expect(result).toContain("Poll inactivity timeout reached")
        expect(abortCount).toBe(1)
      })
    })
  })
})
