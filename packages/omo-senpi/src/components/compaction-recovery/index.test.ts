import { describe, expect, test } from "bun:test"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { buildRejectedCompactionEvent } from "./compaction-recovery.test-support"
import { createRecordingLogger } from "./recording-logger.test-support"
import { createCompactionRecoveryComponent } from "./index"

function messageEntry(id: string, role: string, text: string): Record<string, unknown> {
  return { id, type: "message", message: { role, content: [{ type: "text", text }] } }
}

interface HarnessOptions {
  usageTokens?: number | null
  applied?: boolean
  branchEntries?: readonly unknown[]
}

function createHarness(options: HarnessOptions = {}) {
  const pi = new FakeExtensionAPI()
  const logger = createRecordingLogger()
  const component = createCompactionRecoveryComponent({
    schedule: (fn) => fn(),
    resolveAgentHomeDir: () => undefined,
  })
  component.register(pi, { logger, config: { getFlag: () => undefined } })

  const applyCalls: Array<{ precomputed: Record<string, unknown>; options: Record<string, unknown> }> = []
  const eventCtx = {
    getContextUsage: () => ({
      tokens: options.usageTokens ?? 236744,
      contextWindow: 272000,
      percent: null,
    }),
    getCompactionSettings: () => ({ enabled: true, reserveTokens: 40000, keepRecentTokens: 20000 }),
    isCompacting: () => false,
    applyCompaction: async (precomputed: unknown, compactionOptions: unknown) => {
      applyCalls.push({
        precomputed: precomputed as Record<string, unknown>,
        options: compactionOptions as Record<string, unknown>,
      })
      return { applied: options.applied ?? true, reason: options.applied === false ? "rejected" : "ok" }
    },
    sessionManager: { getBranch: () => options.branchEntries ?? [messageEntry("e0", "user", "hello")] },
  }

  return { pi, logger, applyCalls, eventCtx }
}

describe("createCompactionRecoveryComponent", () => {
  test("#given a rejected required compaction still above the retention budget #when the rejection is observed #then the failure is logged and a deterministic rescue is applied", async () => {
    // given
    const harness = createHarness({
      branchEntries: [messageEntry("e0", "user", "old context"), messageEntry("e1", "assistant", "answer")],
    })

    // when
    await harness.pi.dispatch(
      "session_compact",
      buildRejectedCompactionEvent(),
      harness.eventCtx,
    )
    await Bun.sleep(0)

    // then
    expect(harness.applyCalls).toHaveLength(1)
    expect(harness.applyCalls[0]?.precomputed["firstKeptEntryId"]).toBe("e0")
    expect(harness.applyCalls[0]?.options).toEqual({ reason: "threshold" })
    const phases = harness.logger.entries.map((entry) => JSON.stringify(entry.details))
    expect(phases.some((detail) => detail?.includes('"phase":"rejected"'))).toBe(true)
    expect(phases.some((detail) => detail?.includes('"phase":"rescue-applied"'))).toBe(true)
  })

  test("#given the engine refuses the rescue #when the deferred apply reports not applied #then one visible guidance message is emitted for recovery", async () => {
    // given
    const harness = createHarness({ applied: false })

    // when
    await harness.pi.dispatch("session_compact", buildRejectedCompactionEvent(), harness.eventCtx)
    await Bun.sleep(0)

    // then
    const guidance = harness.pi.messages.filter(
      (call) => call.message["customType"] === "omo-compaction-recovery:guidance",
    )
    expect(guidance).toHaveLength(1)
    expect(guidance[0]?.message["display"]).toBe(true)
    expect(String(guidance[0]?.message["content"])).toContain("new session")
  })

  test("#given guidance was already emitted for this session #when another required rejection arrives #then no duplicate guidance is sent", async () => {
    // given
    const harness = createHarness({ applied: false })
    await harness.pi.dispatch("session_compact", buildRejectedCompactionEvent(), harness.eventCtx)
    await Bun.sleep(0)

    // when
    await harness.pi.dispatch("session_compact", buildRejectedCompactionEvent(), harness.eventCtx)
    await Bun.sleep(0)

    // then
    const guidance = harness.pi.messages.filter(
      (call) => call.message["customType"] === "omo-compaction-recovery:guidance",
    )
    expect(guidance).toHaveLength(1)
  })

  test("#given the session recovered below the budget before the deferred rescue runs #when the rescue evaluates #then nothing is applied and no guidance is sent", async () => {
    // given
    const harness = createHarness({ usageTokens: 22049 })

    // when
    await harness.pi.dispatch("session_compact", buildRejectedCompactionEvent(), harness.eventCtx)
    await Bun.sleep(0)

    // then
    expect(harness.applyCalls).toHaveLength(0)
    expect(harness.pi.messages).toHaveLength(0)
  })

  test("#given a host without the recovery APIs #when a rejection is observed #then only diagnostics are recorded and no error escapes", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createRecordingLogger()
    const component = createCompactionRecoveryComponent({ schedule: (fn) => fn(), resolveAgentHomeDir: () => undefined })
    component.register(pi, { logger, config: { getFlag: () => undefined } })

    // when
    await pi.dispatch("session_compact", buildRejectedCompactionEvent(), { cwd: "/tmp/project" })
    await Bun.sleep(0)

    // then
    expect(pi.messages).toHaveLength(0)
    expect(logger.entries.some((entry) => entry.level === "error")).toBe(false)
  })
})
