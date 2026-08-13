#!/usr/bin/env node
import registerTaskE2eMockProvider, {
  messagesContainChild,
} from "./task-e2e-mock-provider.ts"

declare const process: {
  cwd(): string
  getBuiltinModule<T>(id: string): T
}

interface FsModule {
  appendFileSync(path: string, data: string): void
}

interface PathModule {
  join(...paths: string[]): string
}

const { appendFileSync } = process.getBuiltinModule<FsModule>("fs")
const { join } = process.getBuiltinModule<PathModule>("path")
const capturesFile = "openai-recommendation-captures.jsonl"

type TaskE2eExtensionAPI = Parameters<typeof registerTaskE2eMockProvider>[0]
type MockProvider = Parameters<TaskE2eExtensionAPI["registerProvider"]>[1]
type MockModel = MockProvider["models"][number]

type ReasoningMockModel = MockModel & {
  readonly thinkingLevelMap: Readonly<Record<string, string>>
}

function recommendationModel(model: MockModel): ReasoningMockModel {
  return {
    ...model,
    reasoning: true,
    thinkingLevelMap: {
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  }
}

export default function registerOpenAiRecommendationMockProvider(
  pi: TaskE2eExtensionAPI,
): void {
  const registerProvider: TaskE2eExtensionAPI["registerProvider"] = (_name, provider) => {
    pi.registerProvider("openai", {
      ...provider,
      name: "OMO OpenAI recommendation QA provider",
      baseUrl: "file://openai-recommendation-qa",
      models: provider.models.map(recommendationModel),
      streamSimple(model, context, options) {
        appendFileSync(
          join(process.cwd(), capturesFile),
          `${JSON.stringify({
            child: messagesContainChild(context),
            model: model.id,
          })}\n`,
        )
        return provider.streamSimple(model, context, options)
      },
    })
  }

  const interceptedApi = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerProvider") return registerProvider
      return Reflect.get(target, property, receiver)
    },
  })
  registerTaskE2eMockProvider(interceptedApi)
}
