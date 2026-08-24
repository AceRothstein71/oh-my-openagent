import { describe, expect, test } from "bun:test"

import { TaskRuntimeContext } from "./runtime-context"

describe("TaskRuntimeContext session facts", () => {
  test("#given a live session manager with its file #when captured #then the exact file path is retained", () => {
    // given
    const runtime = new TaskRuntimeContext("/project")

    // when
    runtime.captureFrom({
      sessionManager: {
        getSessionId: () => "session-a",
        getSessionFile: () => "/tmp/senpi/sessions/session-a.jsonl",
      },
    })

    // then
    expect(runtime.sessionId()).toBe("session-a")
    expect(runtime.sessionFile()).toBe("/tmp/senpi/sessions/session-a.jsonl")
  })
})

describe("TaskRuntimeContext service-tier facts", () => {
  test("#given a live context carrying tier facts #when captured #then agentDir, model, tier, and trust are retained", () => {
    // given
    const runtime = new TaskRuntimeContext("/project")
    const model = { api: "openai-codex-responses", provider: "openai-codex", id: "gpt-5.6-luna" }
    const isProjectTrusted = () => true

    // when
    runtime.captureFrom({
      cwd: "/project",
      agentDir: "/home/x/.omo/agent",
      model,
      serviceTier: "priority",
      isProjectTrusted,
    })

    // then
    expect(runtime.agentDir()).toBe("/home/x/.omo/agent")
    expect(runtime.model()).toEqual(model)
    expect(runtime.serviceTier()).toBe("priority")
    expect(runtime.isProjectTrusted()).toBe(isProjectTrusted)
  })

  test("#given no live context yet #when read #then the tier facts are undefined", () => {
    // given
    const runtime = new TaskRuntimeContext("/project")

    // when / then
    expect(runtime.agentDir()).toBeUndefined()
    expect(runtime.model()).toBeUndefined()
    expect(runtime.serviceTier()).toBeUndefined()
    expect(runtime.isProjectTrusted()).toBeUndefined()
  })
})
