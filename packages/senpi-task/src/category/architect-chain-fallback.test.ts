import { describe, expect, test } from "bun:test"

import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import { resolveCategory } from "./index"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

function model(provider: string, id: string): FakeModel {
  return { provider, id }
}

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

// A Claude Pro registry shape: the provider ADVERTISES fable-5 (plan gating happens at request
// time), and the plan-included Claude models answer normally.
const CLAUDE_PRO_REGISTRY = registry([
  model("anthropic", "claude-fable-5"),
  model("anthropic", "claude-opus-5"),
])

describe("architect chain runtime fallback", () => {
  describe("#given a registry that lists fable-5 plus the plan-included opus-5", () => {
    test("#when architect resolves #then the spec carries a later in-family runtime fallback rung", () => {
      // given / when
      const result = resolveCategory("architect", {}, CLAUDE_PRO_REGISTRY)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.provider).toBe("anthropic")
      expect(result.spec.modelId).toBe("claude-fable-5")
      expect(result.spec.variant).toBe("xhigh")
      expect(result.spec.fallback_models).toBeDefined()
      expect(result.spec.fallback_models?.length).toBeGreaterThan(0)
      expect(result.spec.fallback_models?.[0]?.provider).toBe("anthropic")
      expect(result.spec.fallback_models?.[0]?.model_id).toBe("claude-opus-5")
      expect(result.spec.fallback_models?.[0]?.variant).toBe("xhigh")
    })
  })

  describe("#given the builtin architect fallback chain", () => {
    test("#when inspected #then it has more than one rung so quota-dead rungs can advance", () => {
      // given / when
      const chain = CATEGORY_FALLBACK_CHAINS.architect

      // then
      expect(chain.length).toBeGreaterThan(1)
    })

    test("#when inspected #then every rung stays inside the Claude model family", () => {
      // given / when
      const chain = CATEGORY_FALLBACK_CHAINS.architect

      // then
      for (const rung of chain) {
        expect(rung.model.startsWith("claude-")).toBe(true)
      }
    })
  })

  describe("#given a registry without fable-5 but with opus-5", () => {
    test("#when architect resolves #then the activation gate still blocks before any chain fallback", () => {
      // given
      const models = registry([model("anthropic", "claude-opus-5")])

      // when
      const result = resolveCategory("architect", {}, models)

      // then
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error("Expected model_unavailable")
      expect(result.attemptedModel).toBe("anthropic/claude-fable-5")
      expect(result.availableCategories).not.toContain("architect")
    })
  })
})
