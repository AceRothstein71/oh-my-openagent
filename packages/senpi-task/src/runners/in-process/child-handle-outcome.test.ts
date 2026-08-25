import { describe, expect, test } from "bun:test"

import { createChildHandle, type ChildSession, type ChildSessionEvent, type ChildSessionListener } from "./child-handle"

type EmittingSessionControls = {
  readonly session: ChildSession
  readonly lastText: { value: string | undefined }
  emit(event: ChildSessionEvent): void
  resolvePrompt(): void
}

// Controllable ChildSession that also emits subscribed events, so turn outcomes can be driven the
// way a real senpi AgentSession drives them: message_end events first, then prompt() resolution.
function createEmittingSession(sessionId = "child-session-1"): EmittingSessionControls {
  const listeners = new Set<ChildSessionListener>()
  const lastText = { value: undefined as string | undefined }
  let settle: (() => void) | undefined
  const session: ChildSession = {
    sessionId,
    prompt() {
      return new Promise<void>((resolve) => {
        settle = resolve
      })
    },
    async steer() {},
    async followUp() {},
    async abort() {},
    subscribe(listener: ChildSessionListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLastAssistantText() {
      return lastText.value
    },
    dispose() {},
  }
  return {
    session,
    lastText,
    emit: (event) => {
      for (const listener of listeners) listener(event)
    },
    resolvePrompt: () => settle?.(),
  }
}

function assistantEnd(text: string, stopReason: string, errorMessage?: string): ChildSessionEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: text.length > 0 ? [{ type: "text", text }] : [],
      stopReason,
      ...(errorMessage === undefined ? {} : { errorMessage }),
    },
  } as ChildSessionEvent
}

function agentEnd(extra?: Record<string, unknown>): ChildSessionEvent {
  return { type: "agent_end", ...(extra ?? {}) } as ChildSessionEvent
}

describe("createChildHandle turn outcomes", () => {
  test("#given a turn ending with a stopReason error message #when the prompt resolves #then the outcome is an error carrying the provider message", async () => {
    // given a child whose provider request failed; senpi surfaces this as an event, prompt() resolves cleanly
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "review this" })

    // when the failed turn settles
    fake.emit(assistantEnd("", "error", "upstream gateway timeout"))
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    // then the failure is NOT recorded as a silent empty completion
    expect(outcome.status).toBe("error")
    if (outcome.status !== "error") throw new Error("expected error outcome")
    expect(outcome.failure.message).toContain("upstream gateway timeout")
  })

  test("#given a turn that produces no assistant output at all #when the prompt resolves #then the outcome is an error, never completed with empty text", async () => {
    // given a child that hung and settled without a single assistant message
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "review this" })

    // when the silent turn settles
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    // then
    expect(outcome.status).toBe("error")
    if (outcome.status !== "error") throw new Error("expected error outcome")
    expect(outcome.failure.message).toContain("no assistant output")
  })

  test("#given a revived child whose new turn produces nothing #when the revive turn resolves #then the stale previous response is NOT reused as a fresh completion", async () => {
    // given a first turn that completed with real output
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "first run" })
    fake.emit(assistantEnd("first verdict", "stop"))
    fake.lastText.value = "first verdict"
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "first verdict" })

    // when a revive turn produces no new output
    await handle.followUp("re-emit your verdict")
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    // then the previous run's text must not masquerade as the revive result
    expect(outcome.status).toBe("error")
  })

  test("#given a healthy turn with assistant text #when the prompt resolves #then the outcome completes with this turn's text", async () => {
    // given
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "do the work" })

    // when
    fake.emit(assistantEnd("all done", "stop"))
    fake.resolvePrompt()

    // then
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "all done" })
  })

  test("#given a child whose loop exits (agent_end) while prompt() never resolves #when the turn ends #then the outcome settles completed instead of hanging the parent forever", async () => {
    // given a child like issue #5167's Momus: senpi logs "exiting loop" but its prompt() promise never settles
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "critique the plan" })

    // when the child emits its final assistant message and exits its loop WITHOUT resolving prompt()
    fake.emit(assistantEnd("plan verdict: ship it", "stop"))
    fake.emit(agentEnd())

    // then waitForIdle must settle from the event stream, never hang
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "plan verdict: ship it" })
  })

  test("#given a loop exit with no assistant output while prompt() never resolves #when the turn ends #then the outcome is an error, not an eternal wait", async () => {
    // given a child that exits without producing any assistant message
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "read the plan file" })

    // when the loop exits silently
    fake.emit(agentEnd())

    // then
    const outcome = await handle.waitForIdle()
    expect(outcome.status).toBe("error")
    if (outcome.status !== "error") throw new Error("expected error outcome")
    expect(outcome.failure.message).toContain("no assistant output")
  })

  test("#given an abort followed by a loop exit while prompt() never resolves #when the turn ends #then the outcome is cancelled, not a turn failure", async () => {
    // given
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "long review" })

    // when the parent aborts and the loop exits without prompt() resolving
    await handle.abort()
    fake.emit(agentEnd())

    // then
    expect(await handle.waitForIdle()).toEqual({ status: "cancelled" })
  })

  test("#given an agent_end that will be retried by the runtime fallback #when it arrives mid-turn #then the turn does NOT settle early", async () => {
    // given
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "retryable work" })

    // when a willRetry agent_end arrives (the loop keeps running this turn)
    fake.emit(agentEnd({ willRetry: true }))
    const settledEarly = await Promise.race([
      handle.waitForIdle().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ])

    // then the turn is still pending; only the real settlement path may resolve it
    expect(settledEarly).toBe(false)
    fake.emit(assistantEnd("final after retry", "stop"))
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "final after retry" })
  })

  test("#given a turn already settled by prompt resolution #when a stray agent_end arrives afterwards #then the first outcome wins and a follow-up still revives", async () => {
    // given
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "first run" })
    fake.emit(assistantEnd("first verdict", "stop"))
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "first verdict" })

    // when a stray agent_end arrives after settlement
    fake.emit(agentEnd())

    // then the completed record is untouched and the handle can still revive
    fake.lastText.value = "first verdict"
    await handle.followUp("go again")
    fake.emit(assistantEnd("second verdict", "stop"))
    fake.lastText.value = "second verdict"
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "second verdict" })
  })
})
