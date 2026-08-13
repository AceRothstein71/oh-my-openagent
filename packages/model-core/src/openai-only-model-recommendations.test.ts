import { describe, expect, test } from "bun:test"

import {
  OPENAI_ONLY_AGENT_MODEL_RECOMMENDATIONS,
  OPENAI_ONLY_CATEGORY_MODEL_RECOMMENDATIONS,
  compileOpenAiOnlyModelRecommendations,
  isOpenAiOnlyRuntimeInventory,
} from "./openai-only-model-recommendations"

describe("OpenAI-only model recommendations", () => {
  test("#given the maintained policy #when inspected #then agent and category tuning stays pinned", () => {
    expect(OPENAI_ONLY_AGENT_MODEL_RECOMMENDATIONS).toEqual({
      explore: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
      librarian: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
    })
    expect(OPENAI_ONLY_CATEGORY_MODEL_RECOMMENDATIONS).toEqual({
      artistry: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
      quick: { model: "openai/gpt-5.6-luna-fast" },
      "visual-engineering": { model: "openai/gpt-5.6-sol", variant: "high" },
      writing: { model: "openai/gpt-5.6-sol", variant: "medium" },
    })
  })

  test("#given a canonical OpenAI live inventory #when compiled #then exact available models receive maintained tuning", () => {
    const inventory = [
      { provider: "openai", modelId: "gpt-5.6-sol" },
      { provider: "openai", modelId: "gpt-5.6-terra" },
      { provider: "openai", modelId: "gpt-5.6-luna-fast" },
    ]

    const result = compileOpenAiOnlyModelRecommendations(inventory)

    expect(isOpenAiOnlyRuntimeInventory(inventory)).toBe(true)
    expect(result).toEqual({
      agents: {
        explore: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
        librarian: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
      },
      categories: {
        artistry: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
        quick: { model: "openai/gpt-5.6-luna-fast" },
        "visual-engineering": { model: "openai/gpt-5.6-sol", variant: "high" },
        writing: { model: "openai/gpt-5.6-sol", variant: "medium" },
      },
    })
  })

  test("#given only a subset of recommended models #when compiled #then unavailable recommendations are omitted", () => {
    const result = compileOpenAiOnlyModelRecommendations([
      { provider: "openai", modelId: "gpt-5.6-sol" },
    ])

    expect(result).toEqual({
      agents: {},
      categories: {
        artistry: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
        "visual-engineering": { model: "openai/gpt-5.6-sol", variant: "high" },
        writing: { model: "openai/gpt-5.6-sol", variant: "medium" },
      },
    })
  })

  test("#given a mixed provider inventory #when compiled #then no OpenAI-only overlay is produced", () => {
    const inventory = [
      { provider: "openai", modelId: "gpt-5.6-sol" },
      { provider: "anthropic", modelId: "claude-opus-5" },
    ]

    expect(isOpenAiOnlyRuntimeInventory(inventory)).toBe(false)
    expect(compileOpenAiOnlyModelRecommendations(inventory)).toBeUndefined()
  })

  test("#given an arbitrary compatible provider with copied model ids #when compiled #then protocol compatibility does not establish identity", () => {
    const inventory = [
      { provider: "codexlb", modelId: "gpt-5.6-sol" },
      { provider: "codexlb", modelId: "gpt-5.6-luna-fast" },
    ]

    expect(isOpenAiOnlyRuntimeInventory(inventory)).toBe(false)
    expect(compileOpenAiOnlyModelRecommendations(inventory)).toBeUndefined()
  })

  test("#given known OpenAI gateway identities #when compiled #then nested registry ids stay transport-correct", () => {
    const result = compileOpenAiOnlyModelRecommendations([
      { provider: "vercel", modelId: "openai/gpt-5.6-sol" },
      { provider: "vercel", modelId: "openai/gpt-5.6-luna-fast" },
    ])

    expect(result?.agents.explore).toEqual({
      model: "vercel/openai/gpt-5.6-luna-fast",
      variant: "low",
    })
    expect(result?.categories.artistry).toEqual({
      model: "vercel/openai/gpt-5.6-sol",
      variant: "xhigh",
    })
  })

  test("#given explicit upstream identities on a provider alias #when compiled #then recommendations target the actual registry ids", () => {
    const inventory = [
      { provider: "codexlb", modelId: "sol-balanced", upstreamModelId: "gpt-5.6-sol" },
      { provider: "codexlb", modelId: "luna-priority", upstreamModelId: "gpt-5.6-luna-fast" },
    ]

    expect(isOpenAiOnlyRuntimeInventory(inventory)).toBe(true)
    expect(compileOpenAiOnlyModelRecommendations(inventory)).toEqual({
      agents: {
        explore: { model: "codexlb/luna-priority", variant: "low" },
        librarian: { model: "codexlb/luna-priority", variant: "low" },
      },
      categories: {
        artistry: { model: "codexlb/sol-balanced", variant: "xhigh" },
        quick: { model: "codexlb/luna-priority" },
        "visual-engineering": { model: "codexlb/sol-balanced", variant: "high" },
        writing: { model: "codexlb/sol-balanced", variant: "medium" },
      },
    })
  })
})
