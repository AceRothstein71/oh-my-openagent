/**
 * Detection helpers for replies cut off by the senpi engine's builtin TTSR
 * collapse-repetition rule (issue #7135).
 *
 * The engine truncates the aborted assistant message at the garbage offset and
 * appends a literal marker text block (dist/core/extensions/builtin/ttsr/
 * remediation.js `buildTruncateReplacement`). This module recognizes that exact
 * shape structurally so the adapter can react without importing engine runtime
 * values (bundle purity keeps @code-yeongyu/senpi imports type-only).
 */

/** Literal trailing block the senpi TTSR extension appends to truncated replies. */
export const TTSR_TRUNCATION_MARKER = "[output interrupted by stream rule]"

/** Head budget for the captured excerpt of what the interrupted reply already said. */
const EXCERPT_HEAD_LIMIT = 400
/** Tail budget for the captured excerpt (where the reply was cut off). */
const EXCERPT_TAIL_LIMIT = 600

export interface InterruptedExcerpt {
  /** First characters of the pre-garbage body (what was already delivered). */
  head: string
  /** Last characters of the pre-garbage body after the head window (where it stopped). */
  tail: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function blockValue(block: unknown, kind: string): string | undefined {
  if (!isRecord(block) || block["type"] !== kind) return undefined
  const value = block[kind]
  return typeof value === "string" ? value : undefined
}

function isMarkerBlock(block: unknown): boolean {
  return blockValue(block, "text") === TTSR_TRUNCATION_MARKER
}

function hasToolCallBlock(content: unknown[]): boolean {
  return content.some((block) => isRecord(block) && block["type"] === "toolCall")
}

/**
 * True when the message is exactly what the builtin TTSR extension leaves behind
 * after a collapse abort: an assistant message whose stream ended aborted and
 * whose content ends with the truncation marker. ToolCall-bearing messages never
 * match, so tool-result pairing can never be broken by a downstream shrink.
 */
export function isTtsrTruncatedAbortMessage(message: unknown): message is Record<string, unknown> {
  if (!isRecord(message)) return false
  if (message["role"] !== "assistant") return false
  if (message["stopReason"] !== "aborted") return false
  const content = message["content"]
  if (!Array.isArray(content) || content.length === 0) return false
  if (hasToolCallBlock(content)) return false
  return isMarkerBlock(content[content.length - 1])
}

/**
 * Deterministic head/tail excerpt of the pre-garbage body (text + thinking
 * blocks, marker excluded). Returns null when nothing substantive was delivered,
 * in which case there is nothing worth deduplicating.
 */
export function extractInterruptedExcerpt(content: unknown): InterruptedExcerpt | null {
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (isMarkerBlock(block)) continue
    const text = blockValue(block, "text") ?? blockValue(block, "thinking")
    if (typeof text === "string" && text.trim().length > 0) parts.push(text)
  }
  const joined = parts.join("\n\n").trim()
  if (joined.length === 0) return null
  const head = joined.slice(0, EXCERPT_HEAD_LIMIT)
  const rest = joined.slice(EXCERPT_HEAD_LIMIT)
  const tail = rest.slice(-EXCERPT_TAIL_LIMIT)
  return { head, tail }
}
