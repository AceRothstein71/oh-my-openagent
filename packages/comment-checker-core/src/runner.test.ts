import { describe, expect, test } from "bun:test"

import { runCommentChecker } from "./runner"

function createStream(text = ""): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (text.length > 0) {
        controller.enqueue(new TextEncoder().encode(text))
      }
      controller.close()
    },
  })
}

describe("comment checker runner", () => {
  test("#given an EPIPE-like stdin write failure #when running the checker #then it returns the empty result", async () => {
    // given
    const writeFailure = new Error("EPIPE: broken pipe")
    const signals: string[] = []

    // when
    const result = await runCommentChecker(
      {
        binaryPath: "/tmp/comment-checker",
        hookInput: {
          session_id: "session-1",
          tool_name: "write",
          transcript_path: "/tmp/transcript.json",
          cwd: "/tmp",
          hook_event_name: "tool.execute.after",
          tool_input: {},
        },
      },
      {
        existsSync: () => true,
        spawn: () => ({
          stdin: {
            write: () => {
              throw writeFailure
            },
            end: () => {},
          },
          stdout: createStream(),
          stderr: createStream(),
          exited: Promise.resolve(0),
          kill: (signal) => {
            signals.push(signal)
          },
        }),
      },
    )

    // then
    expect(result).toEqual({ hasComments: false, message: "" })
    expect(signals).toEqual(["SIGKILL"])
  })

  test("#given a non-Error stdin write failure #when running the checker #then it kills the child and rethrows the value", async () => {
    // given
    const writeFailure = Symbol("stdin failure")
    const cleanupFailure = Symbol("cleanup failure")
    const signals: string[] = []

    // when
    const result = runCommentChecker(
      {
        binaryPath: "/tmp/comment-checker",
        hookInput: {
          session_id: "session-1",
          tool_name: "write",
          transcript_path: "/tmp/transcript.json",
          cwd: "/tmp",
          hook_event_name: "tool.execute.after",
          tool_input: {},
        },
      },
      {
        existsSync: () => true,
        spawn: () => ({
          stdin: {
            write: () => {
              throw writeFailure
            },
            end: () => {},
          },
          stdout: createStream(),
          stderr: createStream(),
          exited: Promise.resolve(0),
          kill: (signal) => {
            signals.push(signal)
            throw cleanupFailure
          },
        }),
      },
    )

    // then
    let caughtFailure: unknown
    try {
      await result
    } catch (error) {
      caughtFailure = error
    }
    expect(caughtFailure).toBe(writeFailure)
    expect(signals).toEqual(["SIGKILL"])
  })

  test("#given spawning an incompatible checker throws #when running the checker #then it returns the empty result", async () => {
    // given
    const spawnFailure = new Error("spawn ENOEXEC")

    // when
    const result = await runCommentChecker(
      {
        binaryPath: "/tmp/comment-checker",
        hookInput: {
          session_id: "session-1",
          tool_name: "write",
          transcript_path: "/tmp/transcript.json",
          cwd: "/tmp",
          hook_event_name: "tool.execute.after",
          tool_input: {},
        },
      },
      {
        existsSync: () => true,
        spawn: () => {
          throw spawnFailure
        },
      },
    )

    // then
    expect(result).toEqual({ hasComments: false, message: "" })
  })

  test("#given checker exit code 2 #when running the checker #then it preserves normalized feedback", async () => {
    // given
    const feedback = "line 1: redundant comment\r\nline 2: stale comment"

    // when
    const result = await runCommentChecker(
      {
        binaryPath: "/tmp/comment-checker",
        hookInput: {
          session_id: "session-1",
          tool_name: "write",
          transcript_path: "/tmp/transcript.json",
          cwd: "/tmp",
          hook_event_name: "tool.execute.after",
          tool_input: {},
        },
      },
      {
        existsSync: () => true,
        spawn: () => ({
          stdin: {
            write: () => {},
            end: () => {},
          },
          stdout: createStream(),
          stderr: createStream(feedback),
          exited: Promise.resolve(2),
          kill: () => {},
        }),
      },
    )

    // then
    expect(result).toEqual({
      hasComments: true,
      message: "line 1: redundant comment\nline 2: stale comment",
    })
  })

  test("#given a checker ignores SIGTERM #when the timeout grace expires #then it receives SIGKILL", async () => {
    // given
    const signals: string[] = []

    // when
    const result = await runCommentChecker(
      {
        binaryPath: "/tmp/comment-checker",
        hookInput: {
          session_id: "session-1",
          tool_name: "write",
          transcript_path: "/tmp/transcript.json",
          cwd: "/tmp",
          hook_event_name: "tool.execute.after",
          tool_input: {},
        },
      },
      {
        existsSync: () => true,
        spawn: () => ({
          stdin: {
            write: () => {},
            end: () => {},
          },
          stdout: createStream(),
          stderr: createStream(),
          exited: new Promise<number>(() => {}),
          kill: (signal) => {
            signals.push(signal)
          },
        }),
        timeoutMs: 1,
        killGraceMs: 1,
      },
    )

    // then
    expect(result).toEqual({ hasComments: false, message: "" })
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  })
})
