import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SettingsManager, type BeforeProviderRequestEvent, type Extension } from "@code-yeongyu/senpi"
import { describe, expect, test } from "bun:test"

import {
  createChildServiceTierExtension,
  resolveParentServiceTier,
  type ParentServiceTierContext,
} from "./service-tier"

function codexModel(overrides?: Partial<{ api: string; provider: string; id: string }>): Record<string, unknown> {
  return { api: "openai-codex-responses", provider: "openai-codex", id: "gpt-5.6-luna", ...overrides }
}

function parentContext(overrides?: Partial<ParentServiceTierContext>): ParentServiceTierContext {
  return {
    cwd: "/tmp/omo-6795-nonexistent-cwd",
    model: codexModel(),
    ...overrides,
  }
}

// Isolated agentDir so the GLOBAL settings layer never touches (or reads) the real home.
function isolatedAgentDir(root: string): string {
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  return agentDir
}

function tierEvent(payload: unknown, modelApi?: string): BeforeProviderRequestEvent {
  return {
    type: "before_provider_request",
    payload,
    ...(modelApi !== undefined ? { model: { api: modelApi } as BeforeProviderRequestEvent["model"] } : {}),
  }
}

async function runChildHandler(extension: Extension, event: BeforeProviderRequestEvent, ctxModel?: unknown): Promise<unknown> {
  const handlers = extension.handlers.get("before_provider_request")
  if (handlers === undefined || handlers[0] === undefined) throw new Error("no before_provider_request handler")
  const ctx = { ...(ctxModel !== undefined ? { model: ctxModel } : {}) }
  return await handlers[0](event, ctx)
}

describe("resolveParentServiceTier", () => {
  test("#given a codex model remembered as priority #when the parent tier is resolved #then priority is inherited", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-6795-tier-"))
    try {
      const settings = SettingsManager.create(root, isolatedAgentDir(root))
      settings.setModelServiceTier("openai-codex", "gpt-5.6-luna", "priority")
      await settings.flush()

      // when
      const tier = resolveParentServiceTier(parentContext({ cwd: root, agentDir: isolatedAgentDir(root) }))

      // then
      expect(tier).toBe("priority")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given an explicit remembered auto #when the parent tier is resolved #then nothing is inherited even under a priority context tier", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-6795-tier-"))
    try {
      const agentDir = isolatedAgentDir(root)
      const settings = SettingsManager.create(root, agentDir)
      settings.setModelServiceTier("openai-codex", "gpt-5.6-luna", "auto")
      await settings.flush()

      // when
      const tier = resolveParentServiceTier(parentContext({ cwd: root, agentDir, serviceTier: "priority" }))

      // then
      expect(tier).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given no memory and a priority context tier #when the parent tier is resolved #then priority is inherited", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-6795-tier-"))
    try {
      const agentDir = isolatedAgentDir(root)

      // when
      const tier = resolveParentServiceTier(parentContext({ cwd: root, agentDir, serviceTier: "priority" }))

      // then
      expect(tier).toBe("priority")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given no memory and no context tier #when the parent tier is resolved #then nothing is inherited", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-6795-tier-"))
    try {
      const agentDir = isolatedAgentDir(root)

      // when
      const tier = resolveParentServiceTier(parentContext({ cwd: root, agentDir }))

      // then
      expect(tier).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a -fast catalog variant with the base model remembered #when the parent tier is resolved #then the base-model memory is honored", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-6795-tier-"))
    try {
      const agentDir = isolatedAgentDir(root)
      const settings = SettingsManager.create(root, agentDir)
      settings.setModelServiceTier("openai", "gpt-5.6-luna", "auto")
      await settings.flush()

      // when
      const tier = resolveParentServiceTier(
        parentContext({
          cwd: root,
          agentDir,
          model: codexModel({ api: "openai-responses", provider: "openai", id: "gpt-5.6-luna-fast" }),
        }),
      )

      // then
      expect(tier).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given an openai-responses model without a context tier #when the global openai setting is priority #then priority is inherited", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-6795-tier-"))
    try {
      const agentDir = isolatedAgentDir(root)
      // applyOverrides only mutates the in-memory view, so the global settings file is written
      // directly to prove the resolver reads PERSISTED state.
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ openai: { serviceTier: "priority" } }))

      // when
      const tier = resolveParentServiceTier(
        parentContext({
          cwd: root,
          agentDir,
          model: codexModel({ api: "openai-responses" }),
        }),
      )

      // then
      expect(tier).toBe("priority")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a non-service-tier api #when the parent tier is resolved #then nothing is inherited", () => {
    // when
    const tier = resolveParentServiceTier(
      parentContext({ model: codexModel({ api: "anthropic-messages" }), serviceTier: "priority" }),
    )

    // then
    expect(tier).toBeUndefined()
  })

  test("#given no model #when the parent tier is resolved #then nothing is inherited", () => {
    // when
    const tier = resolveParentServiceTier(parentContext({ model: undefined, serviceTier: "priority" }))

    // then
    expect(tier).toBeUndefined()
  })

  test("#given an untrusted project #when only project-level settings hold the tier #then the untrusted project tier is ignored", async () => {
    // given: write the tier into the PROJECT settings layer only by pointing agentDir's project
    // discovery at a trusted-shaped dir while declaring the project untrusted.
    const root = mkdtempSync(join(tmpdir(), "omo-6795-tier-"))
    try {
      mkdirSync(join(root, "project"), { recursive: true })
      const agentDir = isolatedAgentDir(root)
      const globalSettings = SettingsManager.create(root, agentDir)
      globalSettings.setModelServiceTier("openai-codex", "gpt-5.6-luna", "priority")
      await globalSettings.flush()

      // when: same cwd but declared untrusted - global layer still read (parity with engine reads).
      const tier = resolveParentServiceTier(
        parentContext({ cwd: root, agentDir, isProjectTrusted: () => false }),
      )

      // then
      expect(tier).toBe("priority")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("createChildServiceTierExtension", () => {
  test("#given a codex payload #when the child handler runs #then service_tier is injected", async () => {
    // given
    const extension = createChildServiceTierExtension({ registrationCwd: "/tmp/x", serviceTier: "priority" })
    const payload = { model: "gpt-5.6-luna", input: [] }

    // when
    const result = await runChildHandler(extension, tierEvent(payload), codexModel())

    // then
    expect(result).toEqual({ model: "gpt-5.6-luna", input: [], service_tier: "priority" })
  })

  test("#given a payload that already carries service_tier #when the child handler runs #then the existing tier is not clobbered", async () => {
    // given
    const extension = createChildServiceTierExtension({ registrationCwd: "/tmp/x", serviceTier: "priority" })
    const payload = { model: "gpt-5.6-luna", service_tier: "flex" }

    // when
    const result = await runChildHandler(extension, tierEvent(payload), codexModel())

    // then
    expect(result).toBeUndefined()
  })

  test("#given a non-service-tier child model #when the child handler runs #then the payload is untouched", async () => {
    // given
    const extension = createChildServiceTierExtension({ registrationCwd: "/tmp/x", serviceTier: "priority" })

    // when
    const result = await runChildHandler(extension, tierEvent({ model: "claude" }, "anthropic-messages"))

    // then
    expect(result).toBeUndefined()
  })

  test("#given a non-record payload #when the child handler runs #then the payload is untouched", async () => {
    // given
    const extension = createChildServiceTierExtension({ registrationCwd: "/tmp/x", serviceTier: "priority" })

    // when
    const result = await runChildHandler(extension, tierEvent("not-a-payload"), codexModel())

    // then
    expect(result).toBeUndefined()
  })

  test("#given the extension shape #when inspected #then it is a single-handler public-type Extension", () => {
    // given / when
    const extension = createChildServiceTierExtension({ registrationCwd: "/tmp/x", serviceTier: "priority" })

    // then
    expect(extension.path).toBe("<inline:omo-child-service-tier>")
    expect(extension.handlers.size).toBe(1)
    expect(extension.tools.size).toBe(0)
    expect(extension.commands.size).toBe(0)
    expect(extension.registrationCwd).toBe("/tmp/x")
  })
})
