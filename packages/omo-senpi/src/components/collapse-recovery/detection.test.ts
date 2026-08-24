import { describe, expect, test } from "bun:test"

import {
  TTSR_TRUNCATION_MARKER,
  extractInterruptedExcerpt,
  isTtsrTruncatedAbortMessage,
} from "./detection"

function truncatedAbortMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const deliveredBody =
    "A long explanation that was already delivered to the user. " +
    "Filler body sentence padding the delivered portion past the head budget. ".repeat(5)
  return {
    role: "assistant",
    content: [
      { type: "text", text: deliveredBody },
      { type: "thinking", thinking: "the model was reasoning about section two" },
      { type: "text", text: TTSR_TRUNCATION_MARKER },
    ],
    stopReason: "aborted",
    timestamp: Date.now(),
    ...overrides,
  }
}

describe("isTtsrTruncatedAbortMessage", () => {
  test("#given an aborted assistant message ending in the ttsr truncation marker #when checked #then it matches", () => {
    expect(isTtsrTruncatedAbortMessage(truncatedAbortMessage())).toBe(true)
  })

  test("#given a payload that is not an object #when checked #then it does not match", () => {
    expect(isTtsrTruncatedAbortMessage(undefined)).toBe(false)
    expect(isTtsrTruncatedAbortMessage(null)).toBe(false)
    expect(isTtsrTruncatedAbortMessage("assistant")).toBe(false)
  })

  test("#given a non-assistant role #when checked #then it does not match", () => {
    expect(isTtsrTruncatedAbortMessage(truncatedAbortMessage({ role: "user" }))).toBe(false)
    expect(isTtsrTruncatedAbortMessage(truncatedAbortMessage({ role: "custom" }))).toBe(false)
  })

  test("#given a stop reason other than aborted #when checked #then it does not match", () => {
    expect(isTtsrTruncatedAbortMessage(truncatedAbortMessage({ stopReason: "stop" }))).toBe(false)
    expect(isTtsrTruncatedAbortMessage(truncatedAbortMessage({ stopReason: "error" }))).toBe(false)
    expect(isTtsrTruncatedAbortMessage(truncatedAbortMessage({ stopReason: undefined }))).toBe(false)
  })

  test("#given content without the truncation marker #when checked #then it does not match", () => {
    const message = truncatedAbortMessage()
    message.content = [{ type: "text", text: "a perfectly normal completed reply" }]
    expect(isTtsrTruncatedAbortMessage(message)).toBe(false)
  })

  test("#given a marker block that is not trailing #when checked #then it does not match", () => {
    const message = truncatedAbortMessage()
    message.content = [
      { type: "text", text: TTSR_TRUNCATION_MARKER },
      { type: "text", text: "more text streamed after the marker" },
    ]
    expect(isTtsrTruncatedAbortMessage(message)).toBe(false)
  })

  test("#given content carrying toolCall blocks #when checked #then it does not match so tool pairing stays intact", () => {
    const message = truncatedAbortMessage()
    message.content = [
      { type: "toolCall", id: "call_1", name: "read", arguments: {} },
      { type: "text", text: TTSR_TRUNCATION_MARKER },
    ]
    expect(isTtsrTruncatedAbortMessage(message)).toBe(false)
  })
})

describe("extractInterruptedExcerpt", () => {
  test("#given truncated content with text and thinking blocks #when extracted #then the marker block is excluded and head plus tail are returned", () => {
    const message = truncatedAbortMessage()
    const excerpt = extractInterruptedExcerpt(message.content)
    expect(excerpt).not.toBeNull()
    expect(excerpt?.head).toContain("A long explanation")
    expect(excerpt?.tail).toContain("reasoning about section two")
    expect(excerpt?.head).not.toContain(TTSR_TRUNCATION_MARKER)
    expect(excerpt?.tail).not.toContain(TTSR_TRUNCATION_MARKER)
  })

  test("#given only the marker block #when extracted #then there is no excerpt", () => {
    const content = [{ type: "text", text: TTSR_TRUNCATION_MARKER }]
    expect(extractInterruptedExcerpt(content)).toBeNull()
  })

  test("#given oversized text #when extracted #then head and tail are capped at their configured budgets", () => {
    const longText = "x".repeat(5_000)
    const content = [{ type: "text", text: longText }, { type: "text", text: TTSR_TRUNCATION_MARKER }]
    const excerpt = extractInterruptedExcerpt(content)
    expect(excerpt?.head.length).toBeLessThanOrEqual(400)
    expect(excerpt?.tail.length).toBeLessThanOrEqual(600)
  })

  test("#given a malformed content array #when extracted #then it fails safe to null", () => {
    expect(extractInterruptedExcerpt(undefined)).toBeNull()
    expect(extractInterruptedExcerpt("not-an-array")).toBeNull()
    expect(extractInterruptedExcerpt([null, 42])).toBeNull()
  })
})
