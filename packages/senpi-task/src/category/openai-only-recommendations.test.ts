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

  test("#given explicit upstream ids on provider aliases #when existing GPT categories resolve #then their maintained rungs target the aliases", () => {
    const models = registry(
      [model("codexlb", "sol-balanced"), model("codexlb", "terra-balanced")],
      {
        "codexlb/sol-balanced": "gpt-5.6-sol",
        "codexlb/terra-balanced": "gpt-5.6-terra",
      },
    )
    const cases = [
      { category: "ultrabrain", modelId: "sol-balanced", variant: "max" },
      { category: "deep", modelId: "sol-balanced", variant: "medium" },
      { category: "unspecified-low", modelId: "terra-balanced", variant: "high" },
      { category: "unspecified-high", modelId: "sol-balanced", variant: "high" },
    ] as const

    for (const expected of cases) {
      const result = expectResolvedCategory(resolveCategory(expected.category, {}, models))
      expect(result.spec).toMatchObject({
        provider: "codexlb",
        modelId: expected.modelId,
        variant: expected.variant,
      })
      expect(result.availableCategories).toContain(expected.category)
    }
  })

  test("#given nested OpenAI-looking paths on an unrelated provider #when builtin GPT categories resolve #then automatic routing rejects them", () => {
    const models = registry([
      model("unrelated", "openai/gpt-5.6-sol"),
      model("unrelated", "openai/gpt-5.6-terra"),
    ])

    for (const category of [
      "visual-engineering",
      "ultrabrain",
      "deep",
      "unspecified-low",
      "unspecified-high",
    ] as const) {
      const result = resolveCategory(category, {}, models)
      expect(result.kind).toBe("model_unavailable")
      expect(result.availableCategories).not.toContain(category)
    }
  })

  test("#given an explicit nested route #when the automatic route would reject it #then the user category model remains authoritative", () => {
    const models = registry([model("unrelated", "openai/gpt-5.6-sol")])
    const result = expectResolvedCategory(resolveCategory(
      "deep",
      { categories: { deep: { model: "unrelated/openai/gpt-5.6-sol", variant: "low" } } },
      models,
    ))

    expect(result.spec).toMatchObject({
      provider: "unrelated",
      modelId: "openai/gpt-5.6-sol",
      variant: "low",
    })
  })

  test("#given an explicit canonical model chain naming a protected route first #when both entries are available #then the named primary is not filtered out", () => {
    const models = registry([
      model("unrelated", "openai/gpt-5.6-sol"),
      model("openai", "gpt-5.6-terra"),
    ])
    const result = expectResolvedCategory(resolveCategory(
      "deep",
      {
        categories: {
          deep: {
            models: [
              "unrelated/openai/gpt-5.6-sol",
              "openai/gpt-5.6-terra",
            ],
          },
        },
      },
      models,
    ))

    expect(result.spec).toMatchObject({
      provider: "unrelated",
      modelId: "openai/gpt-5.6-sol",
    })
  })

  test("#given a missing explicit primary and protected explicit fallback #when the fallback exists #then every supported tuning suffix can be promoted", () => {
    for (const configuredModel of [
      "unrelated/openai/gpt-5.6-sol high",
      "unrelated/openai/gpt-5.6-sol:high",
      "unrelated/openai/gpt-5.6-sol(high)",
    ]) {
      const result = expectResolvedCategory(resolveCategory(
        "deep",
        {
          categories: {
            deep: {
              model: "openai/missing-primary",
              fallback_models: [configuredModel],
            },
          },
        },
        registry([model("unrelated", "openai/gpt-5.6-sol")]),
      ))

      expect(result.spec).toMatchObject({
        provider: "unrelated",
        modelId: "openai/gpt-5.6-sol",
        variant: "high",
      })
    }
  })

  test("#given only a prompt override plus a nested fake route #when a builtin GPT category resolves #then prompt tuning cannot authorize that route", () => {
    const result = resolveCategory(
      "deep",
      { categories: { deep: { prompt_append: "CUSTOM" } } },
      registry([model("unrelated", "openai/gpt-5.6-sol")]),
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given only a prompt override plus a nested fake route #when an ungated category resolves #then prompt tuning cannot authorize that route", () => {
    const result = resolveCategory(
      "visual-engineering",
      { categories: { "visual-engineering": { prompt_append: "CUSTOM" } } },
      registry([model("unrelated", "openai/gpt-5.6-sol")]),
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given a nested fake route with a mismatched upstream mapping #when an automatic category resolves #then provenance must match the nested id", () => {
    const result = resolveCategory(
      "visual-engineering",
      {},
      registry(
        [model("unrelated", "openai/gpt-5.6-sol")],
        { "unrelated/openai/gpt-5.6-sol": "gpt-5.6-terra" },
      ),
    )

    expect(result.kind).toBe("model_unavailable")
  })

  test("#given canonical and verified alias models #when an existing GPT category resolves #then the maintained provider order keeps canonical OpenAI first", () => {
    const models = registry(
      [model("codexlb", "sol-balanced"), model("openai", "gpt-5.6-sol")],
      { "codexlb/sol-balanced": "gpt-5.6-sol" },
    )

    const result = expectResolvedCategory(resolveCategory("deep", {}, models))

    expect(result.spec).toMatchObject({
      provider: "openai",
      modelId: "gpt-5.6-sol",
      variant: "medium",
    })
  })

  test("#given canonical Sol and Terra without Luna-fast #when quick resolves #then no larger model is substituted", () => {
    const result = resolveCategory(
      "quick",
      {},
      registry([model("openai", "gpt-5.6-sol"), model("openai", "gpt-5.6-terra")]),
    )

    expect(result.kind).toBe("model_unavailable")
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

  test("#given a verified provider alias for Fable #when architect resolves #then the advertised gate has the same live route", () => {
    for (const provider of ["codexlb", "vercel"]) {
      const result = expectResolvedCategory(resolveCategory(
        "architect",
        {},
        registry(
          [model(provider, "fable-balanced")],
          { [`${provider}/fable-balanced`]: "claude-fable-5" },
        ),
      ))

      expect(result.spec).toMatchObject({
        provider,
        modelId: "fable-balanced",
        variant: "xhigh",
      })
      expect(result.availableCategories).toContain("architect")
    }
  })

})
