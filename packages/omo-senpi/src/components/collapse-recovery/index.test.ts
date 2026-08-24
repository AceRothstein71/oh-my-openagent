/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { COLLAPSE_RECOVERY_CONTEXT_TYPE } from "./context-message"
import { TTSR_TRUNCATION_MARKER } from "./detection"
import { createCollapseRecoveryComponent } from "./index"

const DISABLED_FLAG = "omo-senpi-collapse-recovery-disabled"

function createTestContext(pi: FakeExtensionAPI): ComponentContext {
  const logger: ComponentLogger = { info() {}, warn() {}, error() {} }
  return { logger, config: { getFlag: (name) => pi.getFlag(name) } }
}

async function setup(options: { disabled?: boolean } = {}): Promise<FakeExtensionAPI> {
  const pi = new FakeExtensionAPI()
  if (options.disabled === true) pi.setFlag(DISABLED_FLAG, true)
  const component = createCollapseRecoveryComponent()
  await component.register(pi, createTestContext(pi))
  return pi
}

function truncatedAbortMessage(): Record<string, unknown> {
  const deliveredBody =
    "The explanation the user already saw before the loop started. " +
    "Filler sentence padding the delivered body beyond the head window. ".repeat(6)
  return {
    role: "assistant",
    content: [
      { type: "text", text: deliveredBody },
      { type: "thinking", thinking: "mid-reasoning about the next section" },
      { type: "text", text: TTSR_TRUNCATION_MARKER },
    ],
    stopReason: "aborted",
    timestamp: Date.now(),
  }
}

async function endMessage(pi: FakeExtensionAPI, message: unknown): Promise<unknown[]> {
  return pi.dispatch("message_end", { type: "message_end", message }, { cwd: "/tmp/project" })
}

function replacements(results: unknown[]): unknown[] {
  return results.filter((result) => typeof result === "object" && result !== null && "message" in result)
}

function contextMessages(pi: FakeExtensionAPI): Array<{ message: Record<string, unknown>; options?: Record<string, unknown> }> {
  return pi.messages.filter((call) => call.message["customType"] === COLLAPSE_RECOVERY_CONTEXT_TYPE)
}

describe("collapse-recovery component", () => {
  it("#given a ttsr-truncated aborted reply #when message_end is dispatched #then the replacement shrinks the bubble to the truncation marker alone", async () => {
    // given
    const pi = await setup()
    const message = truncatedAbortMessage()

    // when
    const results = await endMessage(pi, message)

    // then
    expect(results).toHaveLength(1)
    const replacement = (results[0] as { message?: Record<string, unknown> }).message
    expect(replacement).toBeDefined()
    expect(replacement?.["role"]).toBe("assistant")
    expect(replacement?.["stopReason"]).toBe("aborted")
    const content = replacement?.["content"] as Array<Record<string, unknown>>
    expect(content).toHaveLength(1)
    expect(content[0]?.["text"]).toBe(TTSR_TRUNCATION_MARKER)
  })

  it("#given a ttsr-truncated aborted reply #when the abort settles #then exactly one hidden dedup context message is sent without triggering its own turn", async () => {
    // given
    const pi = await setup()
    await endMessage(pi, truncatedAbortMessage())

    // when
    await pi.dispatch("agent_settled", { type: "agent_settled" })

    // then
    const sent = contextMessages(pi)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.message["display"]).toBe(false)
    expect(sent[0]?.options).toBeUndefined()
    const text = JSON.stringify(sent[0]?.message["content"])
    expect(text).toContain("already saw before the loop")
    expect(text).toContain("mid-reasoning about the next section")
  })

  it("#given two collapses in one session #when both settle #then the dedup context is injected once but every bubble still shrinks", async () => {
    // given
    const pi = await setup()

    // when
    const firstResults = await endMessage(pi, truncatedAbortMessage())
    await pi.dispatch("agent_settled", { type: "agent_settled" })
    const secondResults = await endMessage(pi, truncatedAbortMessage())
    await pi.dispatch("agent_settled", { type: "agent_settled" })

    // then
    expect(firstResults).toHaveLength(1)
    expect(secondResults).toHaveLength(1)
    expect(contextMessages(pi)).toHaveLength(1)
  })

  it("#given an armed recovery #when fresh user input arrives before settle #then no context message is injected", async () => {
    // given
    const pi = await setup()
    await endMessage(pi, truncatedAbortMessage())

    // when
    await pi.dispatch("input", { type: "input", text: "stop, something else", source: "interactive" })
    await pi.dispatch("agent_settled", { type: "agent_settled" })

    // then
    expect(contextMessages(pi)).toHaveLength(0)
  })

  it("#given an armed recovery #when the user aborts the run #then no context message is injected", async () => {
    // given
    const pi = await setup()
    await endMessage(pi, truncatedAbortMessage())

    // when
    await pi.dispatch("agent_end", { type: "agent_end", abortSource: "user" })
    await pi.dispatch("agent_settled", { type: "agent_settled" })

    // then
    expect(contextMessages(pi)).toHaveLength(0)
  })

  it("#given an armed recovery #when the session aborts #then no context message is injected", async () => {
    // given
    const pi = await setup()
    await endMessage(pi, truncatedAbortMessage())

    // when
    await pi.dispatch("session_abort", { type: "session_abort" })
    await pi.dispatch("agent_settled", { type: "agent_settled" })

    // then
    expect(contextMessages(pi)).toHaveLength(0)
  })

  it("#given the component is disabled by flag #when truncated aborts flow through #then nothing is replaced and nothing is sent", async () => {
    // given
    const pi = await setup({ disabled: true })

    // when
    const results = await endMessage(pi, truncatedAbortMessage())
    await pi.dispatch("agent_settled", { type: "agent_settled" })

    // then
    expect(replacements(results)).toHaveLength(0)
    expect(contextMessages(pi)).toHaveLength(0)
  })

  it("#given a normal completed assistant reply #when message_end is dispatched #then no replacement is returned and nothing is armed", async () => {
    // given
    const pi = await setup()
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "a completed answer" }],
      stopReason: "stop",
      timestamp: Date.now(),
    }

    // when
    const results = await endMessage(pi, message)
    await pi.dispatch("agent_settled", { type: "agent_settled" })

    // then
    expect(replacements(results)).toHaveLength(0)
    expect(contextMessages(pi)).toHaveLength(0)
  })

  it("#given an aborted reply that carries only the truncation marker #when message_end is dispatched #then no replacement and no injection happen", async () => {
    // given
    const pi = await setup()
    const message = {
      role: "assistant",
      content: [{ type: "text", text: TTSR_TRUNCATION_MARKER }],
      stopReason: "aborted",
      timestamp: Date.now(),
    }

    // when
    const results = await endMessage(pi, message)
    await pi.dispatch("agent_settled", { type: "agent_settled" })

    // then
    expect(replacements(results)).toHaveLength(0)
    expect(contextMessages(pi)).toHaveLength(0)
  })
})
