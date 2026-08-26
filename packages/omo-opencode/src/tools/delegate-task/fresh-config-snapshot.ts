import type { AgentOverrides, CategoriesConfig } from "../../config/schema"
import { validatePluginConfig } from "../../config/validate"
import type { OmoConfigEnv } from "@oh-my-opencode/omo-config-core"
import { log } from "../../shared/logger"

export type FreshConfigSnapshot = {
  agentOverrides: AgentOverrides | undefined
  userCategories: CategoriesConfig | undefined
}

export function getSisyphusJuniorModelOverride(agentOverride?: { model?: string }): string | undefined {
  return agentOverride?.model
}

export function loadFreshConfigSnapshot(
  directory: string | undefined,
  environment: OmoConfigEnv = process.env,
): FreshConfigSnapshot | undefined {
  if (!directory) return undefined
  try {
    const validation = validatePluginConfig(directory, environment)
    if (!validation.valid) {
      log("[delegate-task] fresh config invalid; using boot-time snapshot", {
        directory,
        messages: validation.messages.slice(0, 3),
      })
      return undefined
    }
    return {
      agentOverrides: validation.config.agents,
      userCategories: validation.config.categories,
    }
  } catch (error) {
    log("[delegate-task] fresh config read failed; using boot-time snapshot", {
      directory,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
