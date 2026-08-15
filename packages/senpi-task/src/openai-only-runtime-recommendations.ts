import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import {
  canonicalOpenAiRuntimeModelId,
  compileOpenAiOnlyModelRecommendations,
  isOpenAiUpstreamModelId,
  type CompiledOpenAiOnlyModelRecommendations,
  type OpenAiOnlyModelRecommendation,
  type OpenAiRuntimeModelIdentity,
} from "@oh-my-opencode/omo-config-core"

import type { SenpiModelPort, SenpiModelRegistryPort } from "./category"

export type ParsedRuntimeModelIdentity<TModel extends SenpiModelPort> = {
  readonly model: TModel
  readonly provider: string
  readonly modelId: string
}

export type ResolvedRuntimeModelIdentity<TModel extends SenpiModelPort> = ParsedRuntimeModelIdentity<TModel> & {
  readonly upstreamModelId?: string
  readonly upstreamIdentityInvalid?: boolean
  readonly canonicalOpenAiModelId?: string
}

type RuntimeUpstreamIdentity =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "valid"; readonly modelId: string }

const GATEWAY_UPSTREAM_VENDOR_PREFIXES: ReadonlySet<string> = new Set(["openai", "anthropic", "google"])
const KNOWN_OPENAI_MODEL_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "github-copilot",
  "openai",
  "opencode",
  "quotio-openai",
  "vercel",
])

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
    const upstreamIdentity = readUpstreamIdentity(registry, model.model)
    const identity: OpenAiRuntimeModelIdentity = {
      provider: model.provider,
      modelId: model.modelId,
      ...(upstreamIdentity.kind === "valid" ? { upstreamModelId: upstreamIdentity.modelId } : {}),
      ...(upstreamIdentity.kind === "invalid" ? { upstreamIdentityInvalid: true } : {}),
    }
    const canonicalOpenAiModelId = canonicalOpenAiRuntimeModelId(identity)
    return {
      ...model,
      ...(upstreamIdentity.kind === "valid" ? { upstreamModelId: upstreamIdentity.modelId } : {}),
      ...(upstreamIdentity.kind === "invalid" ? { upstreamIdentityInvalid: true } : {}),
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
  // Automatic chains may trust only canonical or upstream-verified OpenAI identities. This rejects
  // both copied bare IDs and copied `openai/...` routes on unrelated providers while explicit user
  // model selections continue to resolve against the unfiltered inventory.
  return models.filter((model) => !isUnprovenOpenAiRoute(model) && !isUnprovenNestedGatewayRoute(model))
}

export function runtimeModelIds<TModel extends SenpiModelPort>(
  models: readonly ResolvedRuntimeModelIdentity<TModel>[],
  options: { readonly includeUpstreamModelIds?: boolean } = {},
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const model of models) {
    ids.add(model.modelId)
    const gatewayModelId = knownGatewayModelId(model)
    if (gatewayModelId !== undefined) ids.add(gatewayModelId)
    if (options.includeUpstreamModelIds !== false && model.upstreamModelId !== undefined) {
      ids.add(model.upstreamModelId)
    }
  }
  return ids
}

export function projectVerifiedUpstreamAliases(
  chain: readonly DelegateFallbackEntry[] | undefined,
  models: readonly ResolvedRuntimeModelIdentity<SenpiModelPort>[],
): readonly DelegateFallbackEntry[] | undefined {
  if (chain === undefined) return undefined
  const projected: DelegateFallbackEntry[] = []
  for (const entry of chain) {
    projected.push(entry)
    for (const model of models) {
      if (model.upstreamModelId !== entry.model) continue
      if (model.provider === "vercel" && knownGatewayModelId(model) === entry.model) continue
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

function isUnprovenOpenAiRoute(model: ResolvedRuntimeModelIdentity<SenpiModelPort>): boolean {
  const localOpenAiModelId = localOpenAiModelIdCandidate(model.modelId)
  if (localOpenAiModelId === undefined) return false
  if (model.upstreamIdentityInvalid === true) return true
  if (model.upstreamModelId !== undefined) {
    return model.canonicalOpenAiModelId !== localOpenAiModelId
  }
  if (model.canonicalOpenAiModelId !== undefined) return false
  return !KNOWN_OPENAI_MODEL_PROVIDER_IDS.has(model.provider)
}

function localOpenAiModelIdCandidate(modelId: string): string | undefined {
  if (isOpenAiUpstreamModelId(modelId)) return modelId
  if (!modelId.startsWith("openai/")) return undefined
  const nestedModelId = modelId.slice("openai/".length)
  return nestedModelId.length > 0 && !nestedModelId.includes("/") && isOpenAiUpstreamModelId(nestedModelId)
    ? nestedModelId
    : undefined
}

function readUpstreamIdentity<TModel extends SenpiModelPort>(
  registry: SenpiModelRegistryPort<TModel>,
  model: TModel,
): RuntimeUpstreamIdentity {
  if (registry.getUpstreamModelId === undefined) return { kind: "absent" }
  try {
    const upstreamModelId = registry.getUpstreamModelId(model)
    if (upstreamModelId === undefined) return { kind: "absent" }
    if (
      typeof upstreamModelId !== "string"
      || upstreamModelId.length === 0
      || upstreamModelId.length > 200
      || /[\u0000-\u001f\u007f-\u009f]/u.test(upstreamModelId)
    ) {
      return { kind: "invalid" }
    }
    return { kind: "valid", modelId: upstreamModelId }
  } catch {
    return { kind: "invalid" }
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
