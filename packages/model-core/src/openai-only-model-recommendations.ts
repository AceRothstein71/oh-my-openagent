export type OpenAiOnlyModelRecommendation = {
  readonly model: string
  readonly variant?: string
}

export type OpenAiRuntimeModelIdentity = {
  readonly provider: string
  readonly modelId: string
  readonly upstreamModelId?: string
}

export type CompiledOpenAiOnlyModelRecommendations = {
  readonly agents: Readonly<Record<string, OpenAiOnlyModelRecommendation>>
  readonly categories: Readonly<Record<string, OpenAiOnlyModelRecommendation>>
}

export const OPENAI_ONLY_AGENT_MODEL_RECOMMENDATIONS = {
  explore: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
  librarian: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
} as const satisfies Readonly<Record<string, OpenAiOnlyModelRecommendation>>

export const OPENAI_ONLY_CATEGORY_MODEL_RECOMMENDATIONS = {
  artistry: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  quick: { model: "openai/gpt-5.6-luna-fast" },
  "visual-engineering": { model: "openai/gpt-5.6-sol", variant: "high" },
  writing: { model: "openai/gpt-5.6-sol", variant: "medium" },
} as const satisfies Readonly<Record<string, OpenAiOnlyModelRecommendation>>

const OPENAI_GATEWAY_PROVIDER_IDS: ReadonlySet<string> = new Set(["vercel"])
const OPENAI_UPSTREAM_MODEL_ID = /^(?:gpt-|o[1-9](?:-|$)|codex-)/i

export function isOpenAiOnlyRuntimeInventory(inventory: readonly OpenAiRuntimeModelIdentity[]): boolean {
  return inventory.length > 0 && inventory.every((model) => canonicalOpenAiRuntimeModelId(model) !== undefined)
}

export function compileOpenAiOnlyModelRecommendations(
  inventory: readonly OpenAiRuntimeModelIdentity[],
): CompiledOpenAiOnlyModelRecommendations | undefined {
  if (!isOpenAiOnlyRuntimeInventory(inventory)) return undefined
  return {
    agents: compileRecommendations(OPENAI_ONLY_AGENT_MODEL_RECOMMENDATIONS, inventory),
    categories: compileRecommendations(OPENAI_ONLY_CATEGORY_MODEL_RECOMMENDATIONS, inventory),
  }
}

function compileRecommendations(
  recommendations: Readonly<Record<string, OpenAiOnlyModelRecommendation>>,
  inventory: readonly OpenAiRuntimeModelIdentity[],
): Readonly<Record<string, OpenAiOnlyModelRecommendation>> {
  const compiled: Record<string, OpenAiOnlyModelRecommendation> = {}
  for (const [name, recommendation] of Object.entries(recommendations)) {
    const recommendedModelId = modelIdFromRecommendation(recommendation.model)
    if (recommendedModelId === undefined) continue
    const available = findPreferredRuntimeModel(inventory, recommendedModelId)
    if (available === undefined) continue
    compiled[name] = {
      model: `${available.provider}/${available.modelId}`,
      ...(recommendation.variant === undefined ? {} : { variant: recommendation.variant }),
    }
  }
  return compiled
}

function findPreferredRuntimeModel(
  inventory: readonly OpenAiRuntimeModelIdentity[],
  canonicalModelId: string,
): OpenAiRuntimeModelIdentity | undefined {
  let preferred: OpenAiRuntimeModelIdentity | undefined
  let preferredRank = Number.POSITIVE_INFINITY
  for (const model of inventory) {
    if (canonicalOpenAiRuntimeModelId(model) !== canonicalModelId) continue
    const rank = model.provider === "openai"
      ? 0
      : OPENAI_GATEWAY_PROVIDER_IDS.has(model.provider)
        ? 1
        : 2
    if (rank >= preferredRank) continue
    preferred = model
    preferredRank = rank
  }
  return preferred
}

function modelIdFromRecommendation(model: string): string | undefined {
  const separatorIndex = model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === model.length - 1) return undefined
  return model.slice(separatorIndex + 1)
}

// Canonical `openai` and the maintained Vercel gateway shape are first-party identities. For any
// other transport, only an explicit runtime upstream mapping is provenance; compatible protocol or
// a copied display id alone is deliberately insufficient.
export function canonicalOpenAiRuntimeModelId(model: OpenAiRuntimeModelIdentity): string | undefined {
  if (model.provider === "openai") return model.modelId
  if (OPENAI_GATEWAY_PROVIDER_IDS.has(model.provider) && model.modelId.startsWith("openai/")) {
    const modelId = model.modelId.slice("openai/".length)
    return modelId.length > 0 && !modelId.includes("/") ? modelId : undefined
  }
  return model.upstreamModelId !== undefined && OPENAI_UPSTREAM_MODEL_ID.test(model.upstreamModelId)
    ? model.upstreamModelId
    : undefined
}
