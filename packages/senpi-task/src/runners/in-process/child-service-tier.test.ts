import { describe, expect, test } from "bun:test"

import { createAgentSession, SessionManager, type CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import { buildChildSessionOptions, requireChildSessionDir } from "./child-options"
import { InProcessRunner, type ChildSpec } from "../in-process"

function childSpec(overrides?: Partial<ChildSpec>): ChildSpec {
  return {
    taskId: "task-1",
    cwd: "/tmp/omo-6795-spec",
    sessionDir: "/tmp/omo-6795-spec/sessions/task-1",
    depth: 1,
    parentSessionId: "parent-1",
    rootSessionId: "root-1",
    prompt: "do the thing",
    ...overrides,
  }
}

function minimalSpecInput(spec: ChildSpec): Parameters<typeof buildChildSessionOptions>[0] {
  return {
    spec,
    sessionManager: SessionManager.inMemory(),
    sharedParentTools: [],
    uiOnlyToolNames: [],
  }
}

async function capturedCreateOptions(options: CreateAgentSessionOptions): Promise<CreateAgentSessionOptions> {
  return options
}

describe("buildChildSessionOptions service-tier inheritance", () => {
  test("#given a spec with an inherited priority tier #when child options are built #then exactly one extension is loaded and it injects the tier", async () => {
    // given
    const spec = childSpec({ serviceTier: "priority" })

    // when
    const options = buildChildSessionOptions(minimalSpecInput(spec))
    const extensions = options.resourceLoader?.getExtensions().extensions ?? []

    // then
    expect(extensions).toHaveLength(1)
    const handlers = extensions[0]?.handlers.get("before_provider_request")
    expect(handlers).toHaveLength(1)
    const result = await handlers?.[0](
      { type: "before_provider_request", payload: { model: "gpt-5.6-luna" } },
      { model: { api: "openai-codex-responses", provider: "openai-codex", id: "gpt-5.6-luna" } },
    )
    expect(result).toEqual({ model: "gpt-5.6-luna", service_tier: "priority" })
  })

  test("#given a spec without a tier #when child options are built #then no extensions are loaded", () => {
    // given / when
    const options = buildChildSessionOptions(minimalSpecInput(childSpec()))

    // then
    expect(options.resourceLoader?.getExtensions().extensions).toHaveLength(0)
  })
})

describe("InProcessRunner service-tier propagation", () => {
  test("#given a runner whose create seam captures options #when a child starts with an inherited tier #then the created session receives a loader carrying the tier extension", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = await capturedCreateOptions(options)
        return {
          sessionId: "child-session",
          prompt: async () => {},
          steer: async () => {},
          followUp: async () => {},
          abort: async () => {},
          subscribe: () => () => {},
          getLastAssistantText: () => undefined,
          dispose: () => {},
        }
      },
    })

    // when
    const handle = await runner.start(childSpec({ serviceTier: "priority" }))
    handle.dispose()

    // then
    const extensions = captured?.resourceLoader?.getExtensions().extensions ?? []
    expect(extensions).toHaveLength(1)
    expect(extensions[0]?.path).toBe("<inline:omo-child-service-tier>")
  })

  test("#given the real senpi createAgentSession #when booted with the tier loader #then the extension binds without loading discovered extensions", async () => {
    // given
    const options = buildChildSessionOptions(minimalSpecInput(childSpec({ serviceTier: "flex" })))

    // when
    const result = await createAgentSession({ ...options, tools: [], customTools: [] })

    // then
    expect(result.extensionsResult.errors).toEqual([])
    expect(result.extensionsResult.extensions).toHaveLength(1)
    result.session.dispose()
  })

  test("#given a spec missing its session dir #when the dir is required #then the typed failure still fires", () => {
    // given / when
    let message: string | undefined
    try {
      requireChildSessionDir(childSpec({ sessionDir: "" }))
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("no sessionDir")
  })
})
