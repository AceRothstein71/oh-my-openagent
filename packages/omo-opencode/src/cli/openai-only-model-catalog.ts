import {
  OPENAI_ONLY_AGENT_MODEL_RECOMMENDATIONS,
  OPENAI_ONLY_CATEGORY_MODEL_RECOMMENDATIONS,
} from "@oh-my-opencode/omo-config-core"

import type { GeneratedOmoConfig, ProviderAvailability } from "./model-fallback-types"

export function isOpenAiOnlyAvailability(availability: ProviderAvailability): boolean {
  return (
    availability.native.openai &&
    !availability.native.claude &&
    !availability.native.gemini &&
    !availability.opencodeGo &&
    !availability.opencodeZen &&
    !availability.copilot &&
    !availability.zai &&
    !availability.kimiForCoding &&
    !availability.bailianCodingPlan &&
    !availability.minimaxCnCodingPlan &&
    !availability.minimaxCodingPlan &&
    !availability.vercelAiGateway
  )
}

export function applyOpenAiOnlyModelCatalog(config: GeneratedOmoConfig): GeneratedOmoConfig {
  return {
    ...config,
    agents: {
      ...config.agents,
      ...OPENAI_ONLY_AGENT_MODEL_RECOMMENDATIONS,
    },
    categories: {
      ...config.categories,
      ...OPENAI_ONLY_CATEGORY_MODEL_RECOMMENDATIONS,
    },
  }
}
