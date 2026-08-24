import { describe, expect, test } from "bun:test"

import { COLLAPSE_RECOVERY_CONTEXT_TYPE, buildCollapseRecoveryContext } from "./context-message"

describe("buildCollapseRecoveryContext", () => {
  test("#given an excerpt #when the hidden context message is built #then it is a hidden custom message of the collapse-recovery type", () => {
    const message = buildCollapseRecoveryContext({ head: "already explained part one", tail: "was mid sentence two" })
    expect(message.customType).toBe(COLLAPSE_RECOVERY_CONTEXT_TYPE)
    expect(message.display).toBe(false)
  })

  test("#given an excerpt #when the message content is inspected #then the excerpt text is carried into the content blocks", () => {
    const message = buildCollapseRecoveryContext({ head: "HEAD-EXCERPT-SENTINEL", tail: "TAIL-EXCERPT-SENTINEL" })
    const content = message.content
    expect(Array.isArray(content)).toBe(true)
    const text = content.map((block) => (typeof block === "object" && block !== null ? Reflect.get(block, "text") : undefined)).filter((value): value is string => typeof value === "string").join("\n")
    expect(text).toContain("HEAD-EXCERPT-SENTINEL")
    expect(text).toContain("TAIL-EXCERPT-SENTINEL")
  })

  test("#given the built message #when its details are inspected #then they attribute the message to the collapse-repetition rule", () => {
    const message = buildCollapseRecoveryContext({ head: "h", tail: "t" })
    expect(message.details).toEqual({ rule: "collapse-repetition" })
  })

  test("#given empty excerpt strings #when built #then the message still carries a usable instruction without excerpt markers", () => {
    const message = buildCollapseRecoveryContext({ head: "", tail: "" })
    expect(message.customType).toBe(COLLAPSE_RECOVERY_CONTEXT_TYPE)
    expect(message.display).toBe(false)
    const text = message.content.map((block) => (typeof block === "object" && block !== null ? Reflect.get(block, "text") : undefined)).filter((value): value is string => typeof value === "string").join("\n")
    expect(text).not.toContain('""')
  })
})
