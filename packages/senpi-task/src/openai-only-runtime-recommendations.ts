import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import {
  canonicalOpenAiRuntimeModelId,
  compileOpenAiOnlyModelRecommendations,
  type CompiledOpenAiOnlyModelRecommendations,
  type OpenAiOnlyModelRecommendation,
  type OpenAiRuntimeModelIdentity,
} from "@oh-my-opencode/model-core"

import type { SenpiModelPort, SenpiModelRegistryPort } from "./category"

export type ParsedRuntimeModelIdentity<TModel extends SenpiModelPort> = {
  readonly model: TModel
  readonly provider: string
  readonly modelId: string
}

export type ResolvedRuntimeModelIdentity<TModel extends SenpiModelPort> = ParsedRuntimeModelIdentity<TModel> & {
  readonly upstreamModelId?: string
  readonly canonicalOpenAiModelId?: string
}

const GATEWAY_UPSTREAM_VENDOR_PREFIXES: ReadonlySet<string> = new Set(["openai", "anthropic", "google"])

export function compileSenpiOpenAiOnlyModelRecommendations<TModel extends SenpiModelPort>(
  registry: SenpiModelRegistryPort<TModel>,
  models: readonly ParsedRuntimeModelIdentity<TModel>[],
): CompiledOpenAiOnlyModelRecommendations | undefined {
  const inventory: readonly OpenAiRuntimeModelIdentity[] = resolveRuntimeModelIdentities(registry, models)
  return compileOpenAiOnlyModelRecommendations(inventory)
}

export function resolveRuntimeModelIdentities<TModel extends SenpiModelPort>(
  registry: SenpiModelRegistryPort<TModel>,
  models: readonly ParsedRuntimeModelIdentity<TModel>[],
): readonly ResolvedRuntimeModelIdentity<TModel>[] {
  return models.map((model) => {
    const upstreamModelId = readUpstreamModelId(registry, model.model)
    const identity: OpenAiRuntimeModelIdentity = {
      provider: model.provider,
      modelId: model.modelId,
      ...(upstreamModelId === undefined ? {} : { upstreamModelId }),
    }
    const canonicalOpenAiModelId = canonicalOpenAiRuntimeModelId(identity)
    return {
      ...model,
      ...(upstreamModelId === undefined ? {} : { upstreamModelId }),
      ...(canonicalOpenAiModelId === undefined ? {} : { canonicalOpenAiModelId }),
    }
  })
}

// A nested vendor path is an automatic route only when its outer provider is the maintained Vercel
// gateway or Senpi supplies an explicit compatibility mapping. This guard is intentionally local:
// delegate-core's general cross-provider fuzzy matching remains part of its public contract.
export function filterAutomaticRuntimeModelIdentities<TModel extends SenpiModelPort>(
  models: readonly ResolvedRuntimeModelIdentity<TModel>[],
): readonly ResolvedRuntimeModelIdentity<TModel>[] {
  return models.filter((model) => !isUnprovenNestedGatewayRoute(model))
}

export function runtimeModelIds<TModel extends SenpiModelPort>(
  models: readonly ResolvedRuntimeModelIdentity<TModel>[],
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const model of models) {
    ids.add(model.modelId)
    const gatewayModelId = knownGatewayModelId(model)
    if (gatewayModelId !== undefined) ids.add(gatewayModelId)
    if (model.upstreamModelId !== undefined) ids.add(model.upstreamModelId)
  }
  return ids
}

export function projectVerifiedOpenAiAliases(
  chain: readonly DelegateFallbackEntry[] | undefined,
  models: readonly ResolvedRuntimeModelIdentity<SenpiModelPort>[],
): readonly DelegateFallbackEntry[] | undefined {
  if (chain === undefined) return undefined
  const projected: DelegateFallbackEntry[] = []
  for (const entry of chain) {
    projected.push(entry)
    for (const model of models) {
      if (model.canonicalOpenAiModelId !== entry.model) continue
      if (model.provider === "vercel") continue
      if (entry.providers.includes(model.provider) && model.modelId === entry.model) continue
      const alias = {
        providers: [model.provider],
        model: model.modelId,
        ...(entry.variant === undefined ? {} : { variant: entry.variant }),
      }
      if (!projected.some((candidate) => sameFallbackEntry(candidate, alias))) projected.push(alias)
    }
  }
  return projected
}

export function recommendationToFallbackEntry(
  recommendation: OpenAiOnlyModelRecommendation | undefined,
): DelegateFallbackEntry | undefined {
  if (recommendation === undefined) return undefined
  const separatorIndex = recommendation.model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === recommendation.model.length - 1) return undefined
  return {
    providers: [recommendation.model.slice(0, separatorIndex)],
    model: recommendation.model.slice(separatorIndex + 1),
    ...(recommendation.variant === undefined ? {} : { variant: recommendation.variant }),
  }
}

function readUpstreamModelId<TModel extends SenpiModelPort>(
  registry: SenpiModelRegistryPort<TModel>,
  model: TModel,
): string | undefined {
  if (registry.getUpstreamModelId === undefined) return undefined
  try {
    const upstreamModelId = registry.getUpstreamModelId(model)
    if (
      typeof upstreamModelId !== "string"
      || upstreamModelId.length === 0
      || upstreamModelId.length > 200
      || /[\u0000-\u001f\u007f-\u009f]/u.test(upstreamModelId)
    ) {
      return undefined
    }
    return upstreamModelId
  } catch {
    return undefined
  }
}

function isUnprovenNestedGatewayRoute(model: ResolvedRuntimeModelIdentity<SenpiModelPort>): boolean {
  const separatorIndex = model.modelId.indexOf("/")
  if (separatorIndex <= 0) return false
  const vendor = model.modelId.slice(0, separatorIndex)
  if (!GATEWAY_UPSTREAM_VENDOR_PREFIXES.has(vendor)) return false
  const nestedModelId = model.modelId.slice(separatorIndex + 1)
  if (nestedModelId.length === 0 || nestedModelId.includes("/")) return true
  return model.provider !== "vercel" && model.upstreamModelId !== nestedModelId
}

function knownGatewayModelId(model: ResolvedRuntimeModelIdentity<SenpiModelPort>): string | undefined {
  if (model.provider !== "vercel") return undefined
  const separatorIndex = model.modelId.indexOf("/")
  if (separatorIndex <= 0) return undefined
  const vendor = model.modelId.slice(0, separatorIndex)
  const upstreamModelId = model.modelId.slice(separatorIndex + 1)
  return GATEWAY_UPSTREAM_VENDOR_PREFIXES.has(vendor)
    && upstreamModelId.length > 0
    && !upstreamModelId.includes("/")
    ? upstreamModelId
    : undefined
}

function sameFallbackEntry(left: DelegateFallbackEntry, right: DelegateFallbackEntry): boolean {
  return left.model === right.model
    && left.variant === right.variant
    && left.providers.length === right.providers.length
    && left.providers.every((provider, index) => provider === right.providers[index])
}
