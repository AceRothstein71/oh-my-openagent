import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

import { stripCursorCliToolFrames } from "./filter"

export const CURSOR_TOOL_FRAME_FILTER_DISABLED_FLAG = "omo-senpi-cursor-tool-frame-filter-disabled"

interface CursorToolFrameMessageEndEvent {
  type: "message_end"
  message: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isMessageEndEvent(payload: unknown): payload is CursorToolFrameMessageEndEvent {
  return isRecord(payload) && payload["type"] === "message_end" && isRecord(payload["message"])
}

function isTextBlock(block: unknown): block is Record<string, unknown> & { type: "text"; text: string } {
  return isRecord(block) && block["type"] === "text" && typeof block["text"] === "string"
}

// Issue #7169: the pinned senpi cursor-cli-oauth provider leaks `<cursor-cli-tool>` tool protocol
// frames into assistant text. This component replaces the finalized assistant message at the
// message_end boundary (senpi applies MessageEndEventResult.message before session persistence),
// so frames never reach stored sessions or rendered prose. Frames are never converted to host
// toolCall blocks: Cursor already executed those tools in its own subprocess.
export function createCursorToolFrameFilterComponent(): OmoSenpiComponent {
  return {
    name: "cursor-tool-frame-filter",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const isDisabled = (): boolean => ctx.config.getFlag(CURSOR_TOOL_FRAME_FILTER_DISABLED_FLAG) === true

      pi.on("message_end", (payload: unknown): { message: Record<string, unknown> } | undefined => {
        if (isDisabled()) return undefined
        if (!isMessageEndEvent(payload)) return undefined
        const message = payload.message
        if (message["role"] !== "assistant") return undefined
        const content = message["content"]
        if (!Array.isArray(content)) return undefined

        let changed = false
        const nextContent: unknown[] = []
        for (const block of content) {
          if (isTextBlock(block)) {
            const stripped = stripCursorCliToolFrames(block.text)
            if (stripped !== undefined) {
              changed = true
              if (stripped.trim().length > 0) nextContent.push({ ...block, text: stripped })
              continue
            }
          }
          nextContent.push(block)
        }
        if (!changed) return undefined
        return { message: { ...message, content: nextContent } }
      })
    },
  }
}
