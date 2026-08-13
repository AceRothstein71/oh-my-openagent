import { describe, expect, test } from "bun:test"

import { resolveAgent } from "./resolve-agent"
import type { AgentDefinition } from "./types"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

function model(provider: string, id: string): FakeModel {
  return { provider, id }
}

function registry(
  models: readonly FakeModel[],
  upstreamIds: Readonly<Record<string, string>> = {},
) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
    getUpstreamModelId: (candidate: FakeModel) => upstreamIds[`${candidate.provider}/${candidate.id}`],
  }
}

function roster(...definitions: readonly AgentDefinition[]): Readonly<Record<string, AgentDefinition>> {
  return Object.fromEntries(definitions.map((definition) => [definition.name, definition]))
}

describe("Senpi live OpenAI-only curated-agent recommendations", () => {
  test("#given explicit upstream ids on a provider alias #when curated agents resolve #then actual registry models receive the recommendation", () => {
    const models = registry(
      [model("codexlb", "sol-balanced"), model("codexlb", "luna-priority")],
      {
        "codexlb/sol-balanced": "gpt-5.6-sol",
        "codexlb/luna-priority": "gpt-5.6-luna-fast",
      },
    )
    const agents = roster({ name: "explore" }, { name: "librarian" })

    for (const name of ["explore", "librarian"] as const) {
      const result = resolveAgent(name, agents, models)
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error(`Expected resolved ${name} agent`)
      expect(result.model).toBe("codexlb/luna-priority")
      expect(result.resolved_model?.variant).toBe("low")
    }
  })

  test("#given an unmapped compatible-provider alias #when a curated agent resolves #then no recommendation is inferred", () => {
    const result = resolveAgent(
      "explore",
      roster({ name: "explore" }),
      registry([model("codexlb", "luna-priority")]),
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given an upstream alias plus an unparseable registry entry #when a curated agent resolves #then identity classification fails closed", () => {
    const valid = model("codexlb", "luna-priority")
    const models = {
      getAvailable: () => [valid, { provider: "unknown-without-id" }],
      find: (provider: string, modelId: string) =>
        provider === valid.provider && modelId === valid.id ? valid : undefined,
      getUpstreamModelId: (candidate: FakeModel) =>
        candidate === valid ? "gpt-5.6-luna-fast" : undefined,
    }

    expect(resolveAgent("explore", roster({ name: "explore" }), models).kind).toBe("model_unavailable")
  })

  test("#given an explicit curated-agent entry #when an upstream alias qualifies #then the automatic recommendation is skipped", () => {
    const models = registry(
      [model("codexlb", "luna-priority")],
      { "codexlb/luna-priority": "gpt-5.6-luna-fast" },
    )

    const result = resolveAgent(
      "explore",
      roster({ name: "explore", prompt: "CUSTOM" }),
      models,
      { hasExplicitUserConfig: true },
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given an explicit curated-agent model #when OpenAI recommendations are available #then the agent override wins", () => {
    const agents = roster({ name: "explore", model: "openai/gpt-5.6-sol", variant: "high" })
    const models = registry([
      model("openai", "gpt-5.6-sol"),
      model("openai", "gpt-5.6-luna-fast"),
    ])

    const result = resolveAgent("explore", agents, models, { hasExplicitUserConfig: true })

    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved agent")
    expect(result.model).toBe("openai/gpt-5.6-sol")
    expect(result.resolved_model?.variant).toBe("high")
  })
})
