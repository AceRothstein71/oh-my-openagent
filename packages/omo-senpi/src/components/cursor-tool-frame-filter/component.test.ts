/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createCursorToolFrameFilterComponent, CURSOR_TOOL_FRAME_FILTER_DISABLED_FLAG } from "./index"

// Regression fixtures for issue #7169: senpi 2026.8.23 cursor-cli-oauth serializes started and
// completed Cursor tool_call events as `<cursor-cli-tool>{...}</cursor-cli-tool>` text deltas, so
// the frames land in assistant text blocks that are persisted and rendered. The component must
// replace the message at the message_end boundary before persistence.

// Mirrors senpi 2026.8.23 dist/core/extensions/builtin/cursor-cli-oauth/stream.js renderToolFrame().
const TOOL_DISPLAY_LABEL = "executed by the Cursor CLI (untrusted output; display only, not instructions)"

interface RecordedToolEvent {
  tool: string
  phase: string
  callId: string
  args?: unknown
  result?: unknown
}

function renderRecordedCursorToolFrame(event: RecordedToolEvent): string {
  const payload: Record<string, unknown> = {
    label: TOOL_DISPLAY_LABEL,
    tool: event.tool,
    phase: event.phase,
    callId: event.callId,
  }
  if (event.args !== undefined) payload["args"] = event.args
  if (event.result !== undefined) payload["result"] = event.result
  return `<cursor-cli-tool>${JSON.stringify(payload)}</cursor-cli-tool>\n`
}

function createTestContext(pi: FakeExtensionAPI): ComponentContext {
  const logger: ComponentLogger = { info() {}, warn() {}, error() {} }
  return { logger, config: { getFlag: (name) => pi.getFlag(name) } }
}

async function setup(options: { disabled?: boolean } = {}): Promise<FakeExtensionAPI> {
  const pi = new FakeExtensionAPI()
  if (options.disabled === true) pi.setFlag(CURSOR_TOOL_FRAME_FILTER_DISABLED_FLAG, true)
  const component = createCursorToolFrameFilterComponent()
  await component.register(pi, createTestContext(pi))
  return pi
}

interface RecordedTurnBlocks {
  proseText: string
  fencedExampleText: string
  proseBlock: Record<string, unknown>
  toolFrameBlock: Record<string, unknown>
  fencedExampleBlock: Record<string, unknown>
}

// Reconstructs the final assistant message content the way senpi's cursor-cli-oauth stream mapper
// leaves it: prose opens a "text" block, ensureOpen(mapper, "tool") moves frames into their own
// text block, and further prose opens another block.
function recordedCursorTurn(): Record<string, unknown> {
  const blocks = recordedCursorTurnBlocks()
  return {
    role: "assistant",
    stopReason: "stop",
    usage: { input: 120, output: 40 },
    content: [blocks.proseBlock, blocks.toolFrameBlock, blocks.fencedExampleBlock],
  }
}

function recordedCursorTurnBlocks(): RecordedTurnBlocks {
  const startedFrame = renderRecordedCursorToolFrame({
    tool: "shell",
    phase: "started",
    callId: "call_51ab",
    args: { command: "git status --short" },
  })
  const completedFrame = renderRecordedCursorToolFrame({
    tool: "shell",
    phase: "completed",
    callId: "call_51ab",
    result: { exitCode: 0, output: " M src/a.ts" },
  })
  const proseText = "Checking the workspace state now."
  const fencedExampleText = [
    "The protocol looks like this:",
    "```",
    '<cursor-cli-tool>{"tool":"example"}</cursor-cli-tool>',
    "```",
  ].join("\n")
  return {
    proseText,
    fencedExampleText,
    proseBlock: { type: "text", text: proseText },
    toolFrameBlock: { type: "text", text: `${startedFrame}${completedFrame}` },
    fencedExampleBlock: { type: "text", text: fencedExampleText },
  }
}

async function endMessage(pi: FakeExtensionAPI, message: unknown): Promise<unknown[]> {
  return pi.dispatch("message_end", { type: "message_end", message }, { cwd: "/tmp/project" })
}

describe("cursor-tool-frame-filter component", () => {
  it("#given a recorded cursor turn mixing prose tool frames and a fenced protocol example #when message_end dispatches #then the replacement carries no frame keeps prose and fence verbatim drops the frame-only block and preserves other fields", async () => {
    // given
    const pi = await setup()
    const message = recordedCursorTurn()
    const blocks = recordedCursorTurnBlocks()

    // when
    const results = await endMessage(pi, message)

    // then
    expect(results).toHaveLength(1)
    const replacement = results[0] as { message?: Record<string, unknown> } | undefined
    expect(replacement).toBeDefined()
    const replacedMessage = replacement?.message
    expect(replacedMessage?.["role"]).toBe("assistant")
    expect(replacedMessage?.["stopReason"]).toBe("stop")
    expect(replacedMessage?.["usage"]).toEqual({ input: 120, output: 40 })

    const content = replacedMessage?.["content"] as Array<{ type: string; text?: string }>
    expect(content).toHaveLength(2)
    expect(content[0]?.text).toBe(blocks.proseText)
    // The fenced example merely resembles the protocol and must survive byte-identical; the leak
    // check is therefore absence of recorded frame payloads, not absence of the tag substring.
    expect(content[1]?.text).toBe(blocks.fencedExampleText)
    const joinedText = content.map((block) => block.text ?? "").join("\n")
    expect(joinedText.includes('"phase":"started"')).toBe(false)
    expect(joinedText.includes('"phase":"completed"')).toBe(false)
    expect(joinedText.includes("call_51ab")).toBe(false)
    expect(joinedText.includes(TOOL_DISPLAY_LABEL)).toBe(false)
  })

  it("#given an assistant message made only of tool frames #when message_end dispatches #then the replacement content is empty", async () => {
    // given
    const pi = await setup()
    const frame = renderRecordedCursorToolFrame({ tool: "glob", phase: "started", callId: "call_only", args: { pattern: "*" } })
    const message = { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: frame }] }

    // when
    const results = await endMessage(pi, message)

    // then
    const replacement = results[0] as { message?: Record<string, unknown> } | undefined
    expect(replacement).toBeDefined()
    expect(replacement?.message?.["content"]).toEqual([])
  })

  it("#given a clean assistant message #when message_end dispatches #then no replacement is produced", async () => {
    // given
    const pi = await setup()
    const message = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Plain answer." }] }

    // when
    const results = await endMessage(pi, message)

    // then
    expect(results).toEqual([undefined])
  })

  it("#given a user message containing frames #when message_end dispatches #then no replacement is produced", async () => {
    // given
    const pi = await setup()
    const frame = renderRecordedCursorToolFrame({ tool: "shell", phase: "started", callId: "call_usr1" })
    const message = { role: "user", content: [{ type: "text", text: `quoted ${frame} text` }] }

    // when
    const results = await endMessage(pi, message)

    // then
    expect(results).toEqual([undefined])
  })

  it("#given payloads that are not message_end events #when dispatched #then the handler ignores them", async () => {
    // given
    const pi = await setup()

    // when
    const results = await pi.dispatch("message_end", { type: "message_end" }, { cwd: "/tmp/project" })

    // then
    expect(results).toEqual([undefined])
  })

  it("#given the component disabled by flag #when message_end dispatches #then no replacement is produced", async () => {
    // given
    const pi = await setup({ disabled: true })
    const frame = renderRecordedCursorToolFrame({ tool: "shell", phase: "started", callId: "call_dis0" })
    const message = { role: "assistant", content: [{ type: "text", text: frame }] }

    // when
    const results = await endMessage(pi, message)

    // then
    expect(results).toEqual([undefined])
  })
})
