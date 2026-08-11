import {
  createChildProgress,
  runTaskCancel,
  runTaskOutput,
  runTaskSend,
  type ManagedChildEvent,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import type { TaskEngine } from "./engine"
import {
  invalidArguments,
  liveProgressSnapshot,
  parseTaskCancel,
  parseTaskOutput,
  parseTaskSend,
  taskSnapshot,
  type TaskLiveProgressSnapshot,
} from "./task-rpc-codec"

const TASK_UPDATED_EVENT = "omo.task.updated"
const LIVE_STATUSES = new Set<TaskRecord["status"]>(["pending", "running"])

type RpcRequestHandler = (data: unknown) => unknown | Promise<unknown>

type LiveSubscription = {
  readonly progress: ReturnType<typeof createChildProgress>
  readonly unsubscribe: () => void
}

export interface TaskRpcBridge {
  sync(): void
  dispose(): void
}

export function wireTaskRpcBridge(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  engine: TaskEngine,
): TaskRpcBridge {
  const subscriptions = new Map<string, LiveSubscription>()
  const liveProgress = new Map<string, TaskLiveProgressSnapshot>()
  let activeSessionId: string | undefined
  let lastSnapshot: string | undefined
  let disposed = false

  const recordsForSession = (): readonly TaskRecord[] => {
    const sessionId = engine.runtime.sessionId()
    if (sessionId === undefined) return []
    return engine.manager.list({ scope: "parent-session", session_id: sessionId }).map((entry) => entry.record)
  }

  const emit = (records: readonly TaskRecord[] = recordsForSession()): void => {
    const sessionId = engine.runtime.sessionId()
    if (disposed || sessionId === undefined || pi.rpc?.emit === undefined) return
    const data = {
      parent_session_id: sessionId,
      tasks: records.map((record) =>
        taskSnapshot(
          record,
          engine.manager.runStatsSnapshot?.(record.task_id),
          liveProgress.get(record.task_id),
        ),
      ),
    }
    const fingerprint = JSON.stringify(data)
    if (fingerprint === lastSnapshot) return
    lastSnapshot = fingerprint
    pi.rpc.emit(TASK_UPDATED_EVENT, data)
  }

  const removeSubscription = (taskId: string): void => {
    subscriptions.get(taskId)?.unsubscribe()
    subscriptions.delete(taskId)
    liveProgress.delete(taskId)
  }

  const syncSubscriptions = (records: readonly TaskRecord[]): void => {
    const liveIds = new Set(
      records
        .filter((record) => LIVE_STATUSES.has(record.status) && record.residency_state === "resident")
        .map((record) => record.task_id),
    )
    for (const taskId of subscriptions.keys()) {
      if (!liveIds.has(taskId)) removeSubscription(taskId)
    }
    for (const record of records) {
      if (!liveIds.has(record.task_id) || subscriptions.has(record.task_id)) continue
      const progress = createChildProgress(
        record.task_id,
        {
          name: record.name,
          taskSummary: record.task_summary,
          description: record.description,
          category: record.category,
          agentType: record.agent_type,
          resolvedModel: record.resolved_model,
          model: record.model,
        },
        Date.parse(record.created_at),
      )
      const unsubscribe = engine.manager.subscribeChild(record.task_id, (event: ManagedChildEvent) => {
        if (!progress.accept(event)) return
        liveProgress.set(record.task_id, liveProgressSnapshot(progress.details()))
        emit()
      })
      subscriptions.set(record.task_id, { progress, unsubscribe })
    }
  }

  const sync = (): void => {
    if (disposed) return
    const sessionId = engine.runtime.sessionId()
    if (sessionId !== activeSessionId) {
      for (const taskId of [...subscriptions.keys()]) removeSubscription(taskId)
      activeSessionId = sessionId
      lastSnapshot = undefined
    }
    const records = recordsForSession()
    syncSubscriptions(records)
    emit(records)
  }

  registerTaskHandlers(pi, ctx, engine)

  return {
    sync,
    dispose() {
      if (disposed) return
      disposed = true
      for (const taskId of [...subscriptions.keys()]) removeSubscription(taskId)
    },
  }
}

function registerTaskHandlers(pi: SenpiExtensionAPI, ctx: ComponentContext, engine: TaskEngine): void {
  const handle = pi.rpc?.handle
  if (handle === undefined) return
  register(handle, "omo.task.send", async (data) => {
    const input = parseTaskSend(data)
    if ("error" in input) return invalidArguments(input.error)
    return (await runTaskSend(engine.manager, input.value, engine.runtime.sessionId())).details
  })
  register(handle, "omo.task.cancel", async (data) => {
    const input = parseTaskCancel(data)
    if ("error" in input) return invalidArguments(input.error)
    const sessionId = engine.runtime.sessionId()
    const record = engine.manager.get(input.value.task_id)
    if (record !== undefined && sessionId !== undefined && record.parent_session_id !== sessionId) {
      return {
        kind: "scope_denied",
        task_id: record.task_id,
        owning_session_id: record.parent_session_id,
        reason: "Task belongs to another parent session.",
      }
    }
    return (await runTaskCancel(engine.manager, input.value)).details
  })
  register(handle, "omo.task.output", async (data) => {
    const input = parseTaskOutput(data)
    if ("error" in input) return invalidArguments(input.error)
    return (
      await runTaskOutput(
        { manager: engine.manager, stateDir: engine.stateDir },
        input.value,
        engine.runtime.sessionId(),
      )
    ).details
  })
  ctx.logger.info("omo-senpi task RPC handlers registered")
}

function register(
  handle: NonNullable<NonNullable<SenpiExtensionAPI["rpc"]>["handle"]>,
  name: string,
  handler: RpcRequestHandler,
): void {
  handle(name, handler)
}
