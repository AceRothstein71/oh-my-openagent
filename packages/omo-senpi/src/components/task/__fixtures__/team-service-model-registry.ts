import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"

const MODEL = { provider: "omo-mock", id: "mock-1" }

export const TEAM_SERVICE_TEST_MODEL_REGISTRY = {
  authStorage: { kind: "test-auth-storage" },
  getAvailable() {
    return [MODEL]
  },
  find(provider: string, modelId: string) {
    return provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined
  },
} as unknown as ChildModelRegistry
