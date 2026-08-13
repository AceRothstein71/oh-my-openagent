import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import {
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

export function compileSenpiOpenAiOnlyModelRecommendations<TModel extends SenpiModelPort>(
  registry: SenpiModelRegistryPort<TModel>,
  models: readonly ParsedRuntimeModelIdentity<TModel>[],
): CompiledOpenAiOnlyModelRecommendations | undefined {
  const inventory: OpenAiRuntimeModelIdentity[] = models.map((model) => {
    const upstreamModelId = readUpstreamModelId(registry, model.model)
    return {
      provider: model.provider,
      modelId: model.modelId,
      ...(upstreamModelId === undefined ? {} : { upstreamModelId }),
    }
  })
  return compileOpenAiOnlyModelRecommendations(inventory)
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
