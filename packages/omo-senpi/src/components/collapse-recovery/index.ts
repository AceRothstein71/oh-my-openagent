import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { buildCollapseRecoveryContext, type CollapseRecoveryExcerpt } from "./context-message"
import { extractInterruptedExcerpt, isTtsrTruncatedAbortMessage } from "./detection"

const COLLAPSE_RECOVERY_DISABLED_FLAG = "omo-senpi-collapse-recovery-disabled"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Recovers the post-abort UX of the senpi engine's builtin TTSR collapse-repetition
 * rule (issue #7135). The engine truncates the aborted reply but still ships the
 * pre-garbage body as a finished bubble, and its static nudge makes the model
 * rewrite the same answer. This component:
 *
 * 1. shrinks the truncated bubble to the engine's own truncation marker, so the
 *    retry becomes the single user-visible answer; and
 * 2. injects ONE hidden dedup-context message (excerpt of the dropped body) that
 *    reaches the nudge-triggered turn's provider request, so the model continues
 *    or compresses instead of repeating.
 *
 * Injection happens at most once per session, mirroring the engine's default
 * `repeatMode: "once"`, and is disarmed by user input, session aborts, and
 * user-sourced run aborts so context never leaks into an unrelated later turn.
 */
export function createCollapseRecoveryComponent(): OmoSenpiComponent {
  return {
    name: "collapse-recovery",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const isDisabled = (): boolean => ctx.config.getFlag(COLLAPSE_RECOVERY_DISABLED_FLAG) === true

      let armed: CollapseRecoveryExcerpt | null = null
      let injectedOnce = false

      pi.on("message_end", (payload: unknown): { message: Record<string, unknown> } | undefined => {
        if (isDisabled()) return undefined
        const candidate: unknown = isRecord(payload) ? payload["message"] : undefined
        if (!isTtsrTruncatedAbortMessage(candidate)) return undefined
        const excerpt = extractInterruptedExcerpt(candidate["content"])
        if (excerpt === null) return undefined
        armed = excerpt
        // Shrink the visible bubble to the engine's own marker block. Returning a
        // replacement (not mutating) lets the runner chain further handlers safely.
        const content = candidate["content"]
        const markerBlock = Array.isArray(content) ? content[content.length - 1] : undefined
        return { message: { ...candidate, content: [markerBlock] } }
      })

      pi.on("agent_end", (payload: unknown): void => {
        if (isRecord(payload) && payload["abortSource"] === "user") armed = null
      })

      // Mirror the engine extension's cancellation signals: any fresh input or a
      // session abort means no nudge turn is coming, so the excerpt must not wait
      // around and leak into an unrelated future turn.
      pi.on("input", (): void => {
        armed = null
      })

      pi.on("session_abort", (): void => {
        armed = null
      })

      pi.on("agent_settled", (): void => {
        if (isDisabled() || armed === null || injectedOnce) return
        injectedOnce = true
        // No triggerTurn option: the builtin TTSR nudge already owns the retry
        // turn. Without options this lands as session context (or parks in the
        // steering queue mid-startup), either way reaching the retry's first
        // provider request without burning an extra assistant turn.
        pi.sendMessage({ ...buildCollapseRecoveryContext(armed) })
        armed = null
      })
    },
  }
}
