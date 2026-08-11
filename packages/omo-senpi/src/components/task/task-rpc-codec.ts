import type {
  TaskRecord,
  TaskRunStats,
  ToolProgressDetails,
} from "@oh-my-opencode/senpi-task"

export type TaskLiveProgressSnapshot = ReturnType<typeof liveProgressSnapshot>

export function taskSnapshot(
  record: TaskRecord,
  liveRunStats: TaskRunStats | undefined,
  liveProgress: TaskLiveProgressSnapshot | undefined,
) {
  const runStats = liveRunStats ?? record.run_stats
  return {
    task_id: record.task_id,
    name: record.name,
    task_summary: record.task_summary,
    description: record.description,
    agent_type: record.agent_type,
    category: record.category,
    model: record.model,
    status: record.status,
    residency_state: record.residency_state,
    execution_mode: record.execution_mode,
    depth: record.depth,
    created_at: record.created_at,
    updated_at: record.updated_at,
    ...(record.child_session_id === undefined ? {} : { child_session_id: record.child_session_id }),
    ...(record.final_response === undefined ? {} : { final_response: record.final_response }),
    ...(record.error_message === undefined ? {} : { error_message: record.error_message }),
    ...(runStats === undefined ? {} : { run_stats: runStats }),
    ...(liveProgress === undefined ? {} : { live_progress: liveProgress }),
  }
}

export function liveProgressSnapshot(details: ToolProgressDetails) {
  return {
    activity: details.progress.activity,
    started_at: details.progress.startedAt,
    ...(details.currentTool === undefined ? {} : { current_tool: details.currentTool }),
    ...(details.lastAssistantLine === undefined ? {} : { last_assistant_line: details.lastAssistantLine }),
    turns: details.turns,
    ...(details.toolCalls === undefined ? {} : { tool_calls: details.toolCalls }),
    ...(details.tokens === undefined ? {} : { total_tokens: details.tokens }),
    ...(details.outputTokens === undefined ? {} : { output_tokens: details.outputTokens }),
    ...(details.tokensPerSecond === undefined ? {} : { tokens_per_second: details.tokensPerSecond }),
  }
}

export function parseTaskSend(
  value: unknown,
): { readonly value: { readonly to: string; readonly message: string } } | { readonly error: string } {
  if (!isRecord(value)) return { error: "Request must be an object." }
  if (typeof value.to !== "string" || value.to.trim().length === 0) {
    return { error: "to is required." }
  }
  if (typeof value.message !== "string" || value.message.trim().length === 0) {
    return { error: "message is required." }
  }
  return { value: { to: value.to, message: value.message } }
}

export function parseTaskCancel(
  value: unknown,
):
  | { readonly value: { readonly task_id: string; readonly reason?: string } }
  | { readonly error: string } {
  if (!isRecord(value)) return { error: "Request must be an object." }
  if (typeof value.task_id !== "string" || value.task_id.trim().length === 0) {
    return { error: "task_id is required." }
  }
  if (value.reason !== undefined && typeof value.reason !== "string") {
    return { error: "reason must be a string." }
  }
  return {
    value: {
      task_id: value.task_id,
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    },
  }
}

export function parseTaskOutput(
  value: unknown,
):
  | {
      readonly value: {
        readonly task_id: string
        readonly mode?: "status" | "tail" | "full"
        readonly tail_lines?: number
      }
    }
  | { readonly error: string } {
  if (!isRecord(value)) return { error: "Request must be an object." }
  if (typeof value.task_id !== "string" || value.task_id.trim().length === 0) {
    return { error: "task_id is required." }
  }
  if (value.mode !== undefined && value.mode !== "status" && value.mode !== "tail" && value.mode !== "full") {
    return { error: "mode must be status, tail, or full." }
  }
  if (value.tail_lines !== undefined && (!Number.isInteger(value.tail_lines) || Number(value.tail_lines) < 1)) {
    return { error: "tail_lines must be a positive integer." }
  }
  return {
    value: {
      task_id: value.task_id,
      ...(value.mode === undefined ? {} : { mode: value.mode }),
      ...(value.tail_lines === undefined ? {} : { tail_lines: Number(value.tail_lines) }),
    },
  }
}

export function invalidArguments(reason: string) {
  return { kind: "invalid_arguments", reason } as const
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
