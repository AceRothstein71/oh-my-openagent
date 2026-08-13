import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"

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

function expectResolvedCategory(result: ReturnType<typeof resolveCategory<FakeModel>>) {
  if (result.kind !== "resolved") throw new Error(`Expected resolved category, got ${result.kind}`)
  return result
}

describe("Senpi live OpenAI-only recommendations", () => {
  test("#given canonical Sol and Luna-fast inventory #when builtin categories resolve #then maintained OpenAI-only tuning applies", () => {
    const models = registry([
      model("openai", "gpt-5.6-sol"),
      model("openai", "gpt-5.6-terra"),
      model("openai", "gpt-5.6-luna-fast"),
    ])
    const cases = [
      { category: "artistry", modelId: "gpt-5.6-sol", variant: "xhigh" },
      { category: "writing", modelId: "gpt-5.6-sol", variant: "medium" },
      { category: "visual-engineering", modelId: "gpt-5.6-sol", variant: "high" },
      { category: "quick", modelId: "gpt-5.6-luna-fast", variant: undefined },
    ] as const

    for (const expected of cases) {
      const result = expectResolvedCategory(resolveCategory(expected.category, {}, models))
      expect(result.spec.provider).toBe("openai")
      expect(result.spec.modelId).toBe(expected.modelId)
      expect(result.spec.variant).toBe(expected.variant)
      expect(result.availableCategories).toContain(expected.category)
      expect(result.modelSelection.fallbackEntry).toEqual({
        providers: ["openai"],
        model: expected.modelId,
        ...(expected.variant === undefined ? {} : { variant: expected.variant }),
      })
    }
  })

  test("#given an explicit category entry #when the OpenAI-only inventory qualifies #then the user model and tuning win", () => {
    const models = registry([
      model("openai", "gpt-5.6-sol"),
      model("openai", "gpt-5.6-luna-fast"),
      model("openai", "custom-writing"),
    ])

    const result = expectResolvedCategory(resolveCategory(
      "writing",
      { categories: { writing: { model: "openai/custom-writing", variant: "high" } } },
      models,
    ))

    expect(result.spec.modelId).toBe("custom-writing")
    expect(result.spec.variant).toBe("high")
  })

  test("#given only a prompt override for a category #when the OpenAI-only inventory qualifies #then the explicit entry opts out", () => {
    const result = resolveCategory(
      "artistry",
      { categories: { artistry: { prompt_append: "CUSTOM" } } },
      registry([model("openai", "gpt-5.6-sol")]),
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given an arbitrary compatible provider with copied ids #when artistry resolves #then model names alone do not trigger the overlay", () => {
    const result = resolveCategory(
      "artistry",
      {},
      registry([
        model("codexlb", "gpt-5.6-sol"),
        model("codexlb", "gpt-5.6-luna-fast"),
      ]),
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given an incompletely parseable registry #when recommendations resolve #then identity classification fails closed", () => {
    const valid = model("openai", "gpt-5.6-sol")
    const models = {
      getAvailable: () => [valid, { provider: "unknown-without-id" }],
      find: (provider: string, modelId: string) =>
        provider === valid.provider && modelId === valid.id ? valid : undefined,
    }

    expect(resolveCategory("artistry", {}, models).kind).toBe("model_unavailable")
  })

  test("#given explicit upstream ids on a provider alias #when categories resolve #then actual registry models receive the recommendation", () => {
    const models = registry(
      [model("codexlb", "sol-balanced"), model("codexlb", "luna-priority")],
      {
        "codexlb/sol-balanced": "gpt-5.6-sol",
        "codexlb/luna-priority": "gpt-5.6-luna-fast",
      },
    )

    const artistry = expectResolvedCategory(resolveCategory("artistry", {}, models))
    const quick = expectResolvedCategory(resolveCategory("quick", {}, models))

    expect(artistry.spec).toMatchObject({ provider: "codexlb", modelId: "sol-balanced", variant: "xhigh" })
    expect(quick.spec).toMatchObject({ provider: "codexlb", modelId: "luna-priority" })
  })

  test("#given an OpenAI-only inventory without Fable #when architect resolves #then its hard gate remains closed", () => {
    const result = resolveCategory(
      "architect",
      {},
      registry([model("openai", "gpt-5.6-sol"), model("openai", "gpt-5.6-luna-fast")]),
    )

    expect(result.kind).toBe("model_unavailable")
    expect(result.availableCategories).not.toContain("architect")
  })

})
