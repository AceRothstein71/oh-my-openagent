import { join } from "node:path"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { findContinuableBoulderWork } from "./boulder-eligibility"
import {
  getOrCreateStopContinuationGuard,
  type StopContinuationGuard,
} from "./stop-continuation-guard"

export interface StartWorkContinuationComponentOptions {
  // none yet; retained for future DI seams
}

const CONTINUATION_LIMIT = 8

const START_WORK_STEERING_REMINDER = [
  "<omo-senpi-start-work>",
  "An active Prometheus start-work plan is present in this working directory.",
  "Before continuing, read `.omo/boulder.json` and the active plan file to determine what remains; use the ledger and plan as the source of truth.",
  "Continue the current work with evidence-bound execution; do not start unrelated work until every top-level checkbox is `- [x]`.",
  "</omo-senpi-start-work>",
].join("\n")

interface InputEventLike {
  text: string
  source?: unknown
  images?: unknown
  streamingBehavior?: unknown
}

interface SessionManagerLike {
  getSessionId(): string | undefined
}

export function createStartWorkContinuationComponent(
  _options: StartWorkContinuationComponentOptions = {},
): OmoSenpiComponent {
  return {
    name: "start-work-continuation",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const state = {
        consecutiveContinuations: 0,
        lastSignature: undefined as string | undefined,
      }

      // Port of the OpenCode `stop-continuation-guard`: an explicit /stop-continuation
      // command durably suppresses continuation for the session. Shared with `ulw-loop`
      // via a per-pi WeakMap so both components observe the same stopped set. See
      // `./stop-continuation-guard.ts` and issue #6752.
      const guard = getOrCreateStopContinuationGuard(pi)
      registerStopContinuationCommands(pi, ctx, guard, () => {
        // /stop-continuation additionally clears the retry counter and stale-signature
        // memo so a later /resume-continuation starts from a clean slate.
        state.consecutiveContinuations = 0
        state.lastSignature = undefined
      })

      pi.on("input", async (payload, eventCtx) => {
        if (!isInputEvent(payload)) return { action: "continue" }
        if (!isUserSourcedInput(payload)) return { action: "continue" }

        const inputSessionId = extractSessionId(eventCtx)
        // Ordinary user input MUST NOT re-arm continuation for a stopped session. The
        // pre-fix behavior — clearing the counter and signature on every user message —
        // meant that a stop/end steering message was immediately followed by an
        // eligible agent_end injection, effectively re-enabling the continuation cycle
        // (issue #6752 second reproduction). We keep the reset on non-stopped sessions
        // so the existing cap-recovery behavior is preserved.
        if (!inputSessionId || !guard.isStopped(inputSessionId)) {
          state.consecutiveContinuations = 0
          state.lastSignature = undefined
        }
        if (payload.streamingBehavior === undefined) return { action: "continue" }

        const sessionId = inputSessionId
        const cwd = extractCwd(eventCtx)
        if (!sessionId || !cwd) return { action: "continue" }

        // Stopped sessions also do not receive the queued-steer transform. Injecting the
        // <omo-senpi-start-work> steering reminder into a queued prompt would functionally
        // re-arm continuation on the very next turn.
        if (guard.isStopped(sessionId)) return { action: "continue" }

        const continuable = findContinuableBoulderWork(cwd, sessionId)
        if (!continuable) return { action: "continue" }

        return {
          action: "transform",
          text: `${payload.text}\n\n${START_WORK_STEERING_REMINDER}`,
          ...(Array.isArray(payload.images) ? { images: payload.images } : {}),
        }
      })

      pi.on("agent_end", async (_payload, eventCtx) => {
        const sessionId = extractSessionId(eventCtx)
        const cwd = extractCwd(eventCtx)
        if (sessionId && guard.isStopped(sessionId)) {
          ctx.logger.info("omo-senpi start-work-continuation skipped", {
            reason: "stopped-by-user",
          })
          return
        }

        if (state.consecutiveContinuations >= CONTINUATION_LIMIT) {
          ctx.logger.info("omo-senpi start-work-continuation skipped", {
            reason: "continuation-cap-reached",
            count: state.consecutiveContinuations,
          })
          return
        }

        if (!sessionId || !cwd) {
          ctx.logger.info("omo-senpi start-work-continuation skipped", { reason: "missing-context" })
          return
        }

        const continuable = findContinuableBoulderWork(cwd, sessionId)
        if (!continuable) {
          state.lastSignature = undefined
          ctx.logger.info("omo-senpi start-work-continuation skipped", { reason: "not-continuable" })
          return
        }

        const { work, planPath, checklist } = continuable
        const signature = `${work.work_id}:${work.updated_at ?? work.started_at}:${checklist.completed}/${checklist.total}`
        if (state.lastSignature === signature) {
          ctx.logger.info("omo-senpi start-work-continuation skipped", { reason: "stale-signature" })
          return
        }

        state.lastSignature = signature
        state.consecutiveContinuations += 1

        const content = renderDirective({
          planName: work.plan_name,
          planPath,
          boulderPath: join(cwd, ".omo", "boulder.json"),
          ledgerPath: join(cwd, ".omo", "start-work", "ledger.jsonl"),
          checklist,
          worktreePath: work.worktree_path ?? null,
          sessionId: `senpi:${sessionId}`,
        })

        deliverContinuation(pi, ctx, content)
      })

      // Clear per-session guard state when Senpi tears the session down so a resumed
      // session never inherits a stale stop marker from a previous incarnation.
      pi.on("session_shutdown", async (_payload, eventCtx) => {
        const sessionId = extractSessionId(eventCtx)
        if (sessionId) guard.clear(sessionId)
      })
    },
  }
}

interface StopCommandContext {
  readonly sessionManager?: { getSessionId(): unknown }
  readonly ui?: { notify(message: string, type?: "info" | "warning" | "error"): void }
}

function registerStopContinuationCommands(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  guard: StopContinuationGuard,
  onStop: () => void,
): void {
  pi.registerCommand("stop-continuation", {
    description: "Suppress start-work / ulw-loop continuation for this session until /resume-continuation.",
    handler: (_args: string, commandCtx: StopCommandContext) => {
      const sessionId = extractCommandSessionId(commandCtx)
      if (!sessionId) {
        commandCtx.ui?.notify("stop-continuation: no active session id", "warning")
        return
      }
      guard.stop(sessionId)
      onStop()
      ctx.logger.info("omo-senpi start-work-continuation stopped", { sessionId })
      commandCtx.ui?.notify("Continuation stopped. Use /resume-continuation to re-arm.", "info")
    },
  })
  pi.registerCommand("resume-continuation", {
    description: "Re-arm start-work / ulw-loop continuation after /stop-continuation.",
    handler: (_args: string, commandCtx: StopCommandContext) => {
      const sessionId = extractCommandSessionId(commandCtx)
      if (!sessionId) {
        commandCtx.ui?.notify("resume-continuation: no active session id", "warning")
        return
      }
      guard.clear(sessionId)
      ctx.logger.info("omo-senpi start-work-continuation resumed", { sessionId })
      commandCtx.ui?.notify("Continuation resumed.", "info")
    },
  })
}

function extractCommandSessionId(commandCtx: StopCommandContext): string | undefined {
  const manager = commandCtx.sessionManager
  if (!manager || typeof manager.getSessionId !== "function") return undefined
  const id = manager.getSessionId()
  return typeof id === "string" ? id : undefined
}

const START_WORK_CONTINUATION_INJECTION_KEY = "omo-senpi-start-work-continuation"

function deliverContinuation(pi: SenpiExtensionAPI, ctx: ComponentContext, content: string): void {
  if (ctx.idleCoordinator !== undefined) {
    ctx.idleCoordinator.enqueue({
      key: START_WORK_CONTINUATION_INJECTION_KEY,
      source: "boulder-continuation",
      customType: "omo-senpi:start-work-continuation",
      content,
      display: false,
    })
    ctx.idleCoordinator.scheduleFlush()
    return
  }
  pi.sendMessage(
    {
      customType: "omo-senpi:start-work-continuation",
      content,
      display: false,
    },
    { triggerTurn: true, deliverAs: "followUp" },
  )
}

interface DirectiveState {
  planName: string
  planPath: string
  boulderPath: string
  ledgerPath: string
  checklist: { completed: number; remaining: number; total: number; nextTaskLabel: string | null }
  worktreePath: string | null
  sessionId: string
}

function renderDirective(state: DirectiveState): string {
  const worktreeBlock =
    state.worktreePath === null
      ? ""
      : `\n- Worktree: \`${state.worktreePath}\` (all edits, tests, and commands run inside this directory)`
  const nextLabel = state.checklist.nextTaskLabel ?? "none (final gate pending)"
  const finalGateHint =
    state.checklist.remaining === 0
      ? "\nAll top-level checkboxes are complete. Run the Final Verification Wave and mark the boulder work completed."
      : ""

  return [
    "<omo-senpi-start-work-continuation>",
    "You are mid-flight on a Prometheus work plan; this turn is an automatic continuation. Do NOT ask whether to continue — the contract is auto-continue until every top-level checkbox is `- [x]`.",
    "",
    "# State",
    "",
    `- Plan: \`${state.planName}\``,
    `- Plan file: \`${state.planPath}\``,
    `- Boulder state: \`${state.boulderPath}\``,
    `- Remaining top-level checkboxes: ${state.checklist.remaining} of ${state.checklist.total}`,
    `- [Status: ${state.checklist.completed}/${state.checklist.total}, next: ${nextLabel}]`,
    `- Ledger: \`${state.ledgerPath}\``,
    `- Your session id in boulder.json: ${state.sessionId}`,
    `${worktreeBlock}`,
    "",
    "# What to do this turn",
    "",
    "1. Read the plan file AND the ledger first — they are the only sources of truth for what remains and what evidence exists; do not trust your memory of prior turns.",
    `2. When the remaining count is \`0\`, skip checkbox execution and perform the Final gate now. Otherwise, pick the FIRST unchecked top-level checkbox in \`## TODOs\` or \`## Final Verification Wave\`.${finalGateHint}`,
    "3. Apply the checkbox's tier and verify with real-surface evidence. Decompose and dispatch sub-tasks in parallel via Senpi's `task` tool when safe.",
    "4. Honor the delivery mode recorded in the goal/ledger at session start: `--make-pr` finishes through the task-owned worktree and an opened PR, then hands off with the PR URL; `--ship` keeps working until that PR is MERGED, then removes the worktree and syncs `.omo/` state back.",
    "5. After verification, apply the checkbox, append a durable evidence record to the ledger, and continue.",
    "</omo-senpi-start-work-continuation>",
  ].join("\n")
}

function extractCwd(eventCtx: unknown): string | undefined {
  if (isRecord(eventCtx) && typeof eventCtx["cwd"] === "string") {
    return eventCtx["cwd"]
  }
  return undefined
}

function extractSessionId(eventCtx: unknown): string | undefined {
  const sessionManager = extractSessionManager(eventCtx)
  if (sessionManager === undefined) return undefined
  const id = sessionManager.getSessionId()
  return typeof id === "string" ? id : undefined
}

function extractSessionManager(eventCtx: unknown): SessionManagerLike | undefined {
  if (!isRecord(eventCtx)) return undefined
  const value = eventCtx["sessionManager"]
  if (!isRecord(value)) return undefined
  if (typeof value["getSessionId"] !== "function") return undefined
  return value as unknown as SessionManagerLike
}

function isInputEvent(value: unknown): value is InputEventLike {
  return isRecord(value) && typeof value["text"] === "string"
}

function isUserSourcedInput(value: InputEventLike): boolean {
  return value.source !== "extension"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const __testInternals = {
  renderDirective,
}
