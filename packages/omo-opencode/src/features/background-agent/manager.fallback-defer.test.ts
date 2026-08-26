import { describe, test, expect } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager, type BackgroundManagerConfig } from "./manager"
import type { BackgroundTask } from "./types"
import { createFallbackDeferralTracker, type FallbackDeferralScheduleFn } from "./fallback-deferral"

function cast<T>(value: unknown): T {
  return value as T
}

interface ManualDeferral {
  tracker: ReturnType<typeof createFallbackDeferralTracker>
  fireAll(): void
  scheduledCount(): number
  allCancelled(): boolean
}

function createManualDeferral(): ManualDeferral {
  const scheduled: Array<{ onFire: () => void; isCancelled: boolean }> = []
  const scheduleFn: FallbackDeferralScheduleFn = (_delayMs, onFire) => {
    const entry = { onFire, isCancelled: false }
    const cancel = () => {
      entry.isCancelled = true
    }
    scheduled.push(entry)
    return cancel
  }
  return {
    tracker: createFallbackDeferralTracker({ scheduleFn }),
    fireAll() {
      for (const entry of [...scheduled]) {
        if (!entry.isCancelled) {
          entry.onFire()
        }
      }
    },
    scheduledCount() {
      return scheduled.length
    },
    allCancelled() {
      return scheduled.every((entry) => entry.isCancelled)
    },
  }
}

type SessionStatuses = Record<string, { type: string; message?: string }>

function createDeferClient(overrides: {
  status?: () => Promise<{ data: SessionStatuses }>
  messages?: () => Promise<{ data: Array<Record<string, unknown>> }>
  get?: () => Promise<{ data?: { id: string }; error?: { message: string; status: number } }>
} = {}): Record<string, unknown> {
  return {
    session: {
      status: overrides.status ?? (async () => ({ data: {} })),
      get: overrides.get ?? (async () => ({ data: { id: "ses-default" } })),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: overrides.messages ?? (async () => ({ data: [] })),
    },
  }
}

function createDeferredManager(
  clientOverrides: Parameters<typeof createDeferClient>[0],
  manual: ManualDeferral,
  deferMs = 60_000,
): BackgroundManager {
  const pluginContext = cast<PluginInput>({
    client: createDeferClient(clientOverrides),
    directory: tmpdir(),
  })
  const options = {
    pluginContext,
    config: { fallbackDeferMs: deferMs },
    enableParentSessionNotifications: false,
    fallbackDeferral: manual.tracker,
  }
  return new BackgroundManager(cast<BackgroundManagerConfig>(options))
}

function stubProcessKey(manager: BackgroundManager): void {
  cast<{ processKey: (key: string) => Promise<void> }>(manager).processKey = async () => {}
}

const FALLBACK_CHAIN = [
  { providers: ["anthropic"], model: "claude-opus-4-7", variant: "max" },
  { providers: ["anthropic"], model: "claude-opus-4-5", variant: "max" },
]

function injectRunningRetryTask(manager: BackgroundManager, sessionId: string, overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  const task: BackgroundTask = {
    id: `bg_defer_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "msg-defer",
    description: "deferred fallback test task",
    prompt: "test",
    agent: "sisyphus",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 1, lastUpdate: new Date() },
    model: { providerID: "anthropic", modelID: "claude-opus-4.7-thinking" },
    fallbackChain: FALLBACK_CHAIN,
    attemptCount: 0,
    ...overrides,
  }
  cast<{ tasks: Map<string, BackgroundTask> }>(manager).tasks.set(task.id, task)
  return task
}

function emitStatusRetry(manager: BackgroundManager, sessionId: string, message = "Provider is overloaded"): void {
  manager.handleEvent({
    type: "session.status",
    properties: {
      sessionID: sessionId,
      status: { type: "retry", message },
    },
  })
}

function emitTransientSessionError(manager: BackgroundManager, sessionId: string, message = "rate limit exceeded, try again later"): void {
  manager.handleEvent({
    type: "session.error",
    properties: {
      sessionID: sessionId,
      error: { name: "UnknownError", data: { message } },
    },
  })
}

async function drainEventHandlers(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe("BackgroundManager fallback deferral (issue #7319)", () => {
  describe("#given fallbackDeferMs grace is configured", () => {
    test("#when a session.status retry event arrives and the session recovers before grace expires #then the task is not downgraded", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: { ses_recover_busy: { type: "busy" } } }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_recover_busy")

      //#when
      emitStatusRetry(manager, "ses_recover_busy")
      await drainEventHandlers()
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(0)
      expect(task.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4.7-thinking" })
      expect(task.status).toBe("running")

      await manager.shutdown()
    })

    test("#when grace expires while the session is still retrying #then the fallback takeover proceeds", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: { ses_still_retry: { type: "retry", message: "Provider is overloaded" } } }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_still_retry")

      //#when
      emitStatusRetry(manager, "ses_still_retry")
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(0)

      //#when
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(1)
      expect(task.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" })
      expect(task.status).toBe("pending")

      await manager.shutdown()
    })

    test("#when repeated retry signals arrive during the grace window #then exactly one takeover fires", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: { ses_repeat_retry: { type: "retry" } } }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_repeat_retry")

      //#when
      emitStatusRetry(manager, "ses_repeat_retry")
      emitStatusRetry(manager, "ses_repeat_retry")
      emitStatusRetry(manager, "ses_repeat_retry")
      await drainEventHandlers()
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(manual.scheduledCount()).toBe(1)
      expect(task.attemptCount).toBe(1)

      await manager.shutdown()
    })

    test("#when a transient session.error arrives and the session recovers #then the task is not downgraded", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: { ses_error_recover: { type: "busy" } } }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_error_recover")

      //#when
      emitTransientSessionError(manager, "ses_error_recover")
      await drainEventHandlers()
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(0)
      expect(task.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4.7-thinking" })
      expect(task.status).toBe("running")

      await manager.shutdown()
    })

    test("#when grace expires and the session is gone #then the fallback takeover proceeds", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: {} }),
        get: async () => ({ data: undefined, error: { message: "Session not found", status: 404 } }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_gone_dead")

      //#when
      emitTransientSessionError(manager, "ses_gone_dead")
      await drainEventHandlers()
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(1)
      expect(task.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" })

      await manager.shutdown()
    })

    test("#when a terminal session.error arrives #then the downgrade is immediate despite the grace window", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({}, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_terminal_err")

      //#when
      manager.handleEvent({
        type: "session.error",
        properties: {
          sessionID: "ses_terminal_err",
          error: { name: "UnknownError", data: { message: "Model not found: kimi-for-coding/k2p5." } },
        },
      })
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(1)
      expect(manual.scheduledCount()).toBe(0)

      await manager.shutdown()
    })

    test("#when a quota-exhaustion stop error arrives #then the provider failover is immediate despite the grace window", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({}, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_quota_stop")

      //#when
      manager.handleEvent({
        type: "session.error",
        properties: {
          sessionID: "ses_quota_stop",
          error: { name: "QuotaExceededError", data: { message: "quota exceeded: usage limit reached" } },
        },
      })
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(1)
      expect(manual.scheduledCount()).toBe(0)

      await manager.shutdown()
    })

    test("#when the poller sees retry status and the session recovers before grace expires #then the task is not downgraded", async () => {
      //#given
      const manual = createManualDeferral()
      let statusType = "retry"
      const manager = createDeferredManager({
        status: async () => ({ data: { ses_poll_recover: { type: statusType } } }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_poll_recover")

      //#when
      await cast<{ pollRunningTasks: () => Promise<void> }>(manager).pollRunningTasks()
      expect(task.attemptCount).toBe(0)

      statusType = "busy"
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(0)
      expect(task.status).toBe("running")

      await manager.shutdown()
    })

    test("#when the poller sees retry status and grace expires without recovery #then the fallback takeover proceeds", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: { ses_poll_fire: { type: "retry", message: "Provider is overloaded" } } }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_poll_fire")

      //#when
      await cast<{ pollRunningTasks: () => Promise<void> }>(manager).pollRunningTasks()
      expect(task.attemptCount).toBe(0)

      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(1)
      expect(task.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" })

      await manager.shutdown()
    })

    test("#when the session went idle with real output by fire time #then the takeover is skipped", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: { ses_idle_done: { type: "idle" } } }),
        messages: async () => ({
          data: [{
            info: { role: "assistant", finish: "end_turn" },
            parts: [{ type: "text", text: "finished the work" }],
          }],
        }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_idle_done")

      //#when
      emitStatusRetry(manager, "ses_idle_done")
      await drainEventHandlers()
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(0)
      expect(task.status).toBe("running")

      await manager.shutdown()
    })

    test("#when the session went idle without any output by fire time #then the fallback takeover proceeds", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: { ses_idle_empty: { type: "idle" } } }),
        messages: async () => ({ data: [] }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_idle_empty")

      //#when
      emitStatusRetry(manager, "ses_idle_empty")
      await drainEventHandlers()
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(1)

      await manager.shutdown()
    })

    test("#when an assistant message.error arrives and the session recovers #then the task is not downgraded", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: { ses_msgupd_recover: { type: "busy" } } }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_msgupd_recover")

      //#when
      manager.handleEvent({
        type: "message.updated",
        properties: {
          info: {
            id: "msg_errored",
            sessionID: "ses_msgupd_recover",
            role: "assistant",
            error: { name: "UnknownError", data: { message: "503 service unavailable" } },
          },
        },
      })
      await drainEventHandlers()
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(0)
      expect(task.status).toBe("running")

      await manager.shutdown()
    })

    test("#when the task is cancelled during the grace window #then a late fire is a no-op", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({
        status: async () => ({ data: {} }),
        get: async () => ({ data: undefined, error: { message: "Session not found", status: 404 } }),
      }, manual)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_cancelled_grace")

      emitTransientSessionError(manager, "ses_cancelled_grace")
      await drainEventHandlers()

      //#when
      await manager.cancelTask(task.id, { source: "test", abortSession: false })
      manual.fireAll()
      await drainEventHandlers()

      //#then
      expect(task.status).toBe("cancelled")
      expect(task.attemptCount).toBe(0)

      await manager.shutdown()
    })

    test("#when the manager shuts down during the grace window #then pending deferrals are cancelled", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({}, manual)
      stubProcessKey(manager)
      injectRunningRetryTask(manager, "ses_shutdown_defer")

      emitStatusRetry(manager, "ses_shutdown_defer")
      await drainEventHandlers()
      expect(manual.scheduledCount()).toBe(1)

      //#when
      await manager.shutdown()

      //#then
      expect(manual.allCancelled()).toBe(true)
    })
  })

  describe("#given default config without fallbackDeferMs", () => {
    test("#when a session.status retry event arrives #then the immediate takeover behavior is preserved", async () => {
      //#given
      const manual = createManualDeferral()
      const manager = createDeferredManager({}, manual, 0)
      stubProcessKey(manager)
      const task = injectRunningRetryTask(manager, "ses_default_immediate")

      //#when
      emitStatusRetry(manager, "ses_default_immediate")
      await drainEventHandlers()

      //#then
      expect(task.attemptCount).toBe(1)
      expect(task.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" })
      expect(task.status).toBe("pending")
      expect(manual.scheduledCount()).toBe(0)

      await manager.shutdown()
    })
  })
})
