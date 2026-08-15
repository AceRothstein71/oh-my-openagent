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

  test("#given canonical Sol and Terra without Luna-fast #when a curated agent resolves #then no larger model is substituted", () => {
    const result = resolveAgent(
      "explore",
      roster({ name: "explore" }),
      registry([model("openai", "gpt-5.6-sol"), model("openai", "gpt-5.6-terra")]),
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given a nested Luna-looking path on an unrelated provider #when a curated agent resolves #then automatic routing rejects it", () => {
    const result = resolveAgent(
      "explore",
      roster({ name: "explore" }),
      registry([model("unrelated", "openai/gpt-5.6-luna-fast")]),
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given a copied bare Luna id on an unrelated provider #when a curated agent resolves #then automatic routing rejects it", () => {
    const result = resolveAgent(
      "explore",
      roster({ name: "explore" }),
      registry([model("unrelated", "gpt-5.6-luna-fast")]),
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given only a prompt override plus a nested fake route #when a curated agent resolves #then prompt tuning cannot authorize that route", () => {
    const result = resolveAgent(
      "explore",
      roster({ name: "explore", prompt: "CUSTOM" }),
      registry([model("unrelated", "openai/gpt-5.6-luna-fast")]),
      { hasExplicitUserConfig: true },
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given an explicit nested agent model #when automatic routing would reject it #then the user model remains authoritative", () => {
    const result = resolveAgent(
      "explore",
      roster({ name: "explore", model: "unrelated/openai/gpt-5.6-luna-fast" }),
      registry([model("unrelated", "openai/gpt-5.6-luna-fast")]),
      { hasExplicitUserConfig: true },
    )

    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected explicit nested model to resolve")
    expect(result.model).toBe("unrelated/openai/gpt-5.6-luna-fast")
  })

  test("#given an explicit copied bare agent model #when automatic routing would reject it #then the user model remains authoritative", () => {
    const result = resolveAgent(
      "explore",
      roster({ name: "explore", model: "unrelated/gpt-5.6-luna-fast" }),
      registry([model("unrelated", "gpt-5.6-luna-fast")]),
      { hasExplicitUserConfig: true },
    )

    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected explicit copied bare model to resolve")
    expect(result.model).toBe("unrelated/gpt-5.6-luna-fast")
  })

  test("#given an explicit agent chain with a protected nested fallback #when the primary resolves #then the user fallback remains in the runtime chain", () => {
    const result = resolveAgent(
      "explore",
      roster({
        name: "explore",
        models: [
          "openai/gpt-5.6-terra",
          "unrelated/openai/gpt-5.6-sol",
        ],
      }),
      registry([
        model("openai", "gpt-5.6-terra"),
        model("unrelated", "openai/gpt-5.6-sol"),
      ]),
      { hasExplicitUserConfig: true },
    )

    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected explicit agent chain to resolve")
    expect(result.model).toBe("openai/gpt-5.6-terra")
    expect(result.fallback_models).toEqual([{
      source: "agent",
      provider: "unrelated",
      model_id: "openai/gpt-5.6-sol",
      display: "unrelated/openai/gpt-5.6-sol",
    }])
  })

  test("#given a missing explicit primary and a copied bare fallback #when the fallback is available #then the explicit fallback is promoted", () => {
    const result = resolveAgent(
      "explore",
      roster({
        name: "explore",
        models: [
          "openai/gpt-5.6-terra",
          "unrelated/gpt-5.6-luna-fast",
        ],
      }),
      registry([model("unrelated", "gpt-5.6-luna-fast")]),
      { hasExplicitUserConfig: true },
    )

    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected explicit copied bare fallback to resolve")
    expect(result.model).toBe("unrelated/gpt-5.6-luna-fast")
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

  test("#given a prompt-only curated-agent entry #when an upstream alias qualifies #then builtin alias routing remains while the recommendation stays skipped", () => {
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

    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected builtin alias route to resolve")
    expect(result.model).toBe("codexlb/luna-priority")
    expect(result.resolved_model?.variant).toBe("low")
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
