import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { COLLAPSE_RECOVERY_CONTEXT_TYPE } from "../components/collapse-recovery/context-message"
import { TTSR_TRUNCATION_MARKER } from "../components/collapse-recovery/detection"
import { createOmoSenpiComponents } from "./component-list"
import type { ComponentContext, OmoSenpiComponent } from "./types"

const stubTaskComponent: OmoSenpiComponent = { name: "task", register() {} }

function createTestContext(pi: FakeExtensionAPI): ComponentContext {
  const logger = { info() {}, warn() {}, error() {} }
  return { logger, config: { getFlag: (name) => pi.getFlag(name) } }
}

// Regression wiring for issue #7135: the production component list must wire
// collapse-recovery so a TTSR-truncated abort shrinks the persisted bubble and
// sends exactly one hidden dedup-context message toward the nudge retry turn.
describe("collapse-recovery production wiring", () => {
  it("#given the production component list #when components are created #then collapse-recovery is registered ahead of the tool components", () => {
    const names = createOmoSenpiComponents(stubTaskComponent).map((component) => component.name)
    expect(names).toContain("collapse-recovery")
    expect(names.indexOf("collapse-recovery")).toBeLessThan(names.indexOf("comment-checker"))
  })

  it("#given the production collapse-recovery component #when a ttsr-truncated abort settles #then the bubble shrinks to the marker and one hidden dedup context rides to the retry turn", async () => {
    // given the component resolved from the real production list, not a fresh factory call
    const pi = new FakeExtensionAPI()
    const component = createOmoSenpiComponents(stubTaskComponent).find(
      (candidate) => candidate.name === "collapse-recovery",
    )
    expect(component).toBeDefined()
    await component?.register(pi, createTestContext(pi))

    // and the engine-shaped post-TTSR message_end payload: truncated body plus trailing marker
    const deliveredBody = "The architecture walkthrough the user already read. ".repeat(12)
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: deliveredBody },
        { type: "text", text: TTSR_TRUNCATION_MARKER },
      ],
      stopReason: "aborted",
      timestamp: Date.now(),
    }

    // when the abort settles in the engine's sequence (message_end, then agent_settled)
    const results = await pi.dispatch("message_end", { type: "message_end", message })
    await pi.dispatch("agent_settled", { type: "agent_settled" })

    // then the replacement keeps only the marker block, dropping the partial body
    expect(results).toHaveLength(1)
    const replacement = (results[0] as { message?: Record<string, unknown> }).message
    expect(replacement?.["role"]).toBe("assistant")
    const content = replacement?.["content"] as Array<Record<string, unknown>>
    expect(content).toHaveLength(1)
    expect(content[0]?.["text"]).toBe(TTSR_TRUNCATION_MARKER)

    // and exactly one hidden context message is sent without triggerTurn options,
    // so the builtin nudge keeps owning the retry turn while the excerpt reaches its request
    const sent = pi.messages.filter((call) => call.message["customType"] === COLLAPSE_RECOVERY_CONTEXT_TYPE)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.message["display"]).toBe(false)
    expect(sent[0]?.options).toBeUndefined()
    expect(JSON.stringify(sent[0]?.message["content"])).toContain("architecture walkthrough")
  })
})
