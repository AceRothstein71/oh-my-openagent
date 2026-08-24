import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ReflectionReservationStore,
  TranscriptJournal,
  buildIdentityPaths,
  type MemoryIdentity,
  type MemoryIdentityPaths,
} from "@oh-my-opencode/memory-core"

import { createReflectionRunIdFactory } from "./reflection-run-id"
import { ensureReflectionCompletion } from "./worker/completion-records"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

interface Fixture {
  readonly identity: MemoryIdentity
  readonly paths: MemoryIdentityPaths
  readonly journal: TranscriptJournal
}

async function fixture(): Promise<Fixture> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-runid-collision-")))
  roots.push(root)
  const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
  const journal = new TranscriptJournal({ journalDir: join(identity.paths.transcripts, "conversation-a") })
  await journal.reconcile([{ kind: "assistant", messageId: "assistant-1", textBlocks: ["one"] }])
  return { identity, paths: identity.paths, journal }
}

/** A store wired the way identity-runtime wires it after the fix: ids scoped to persisted state. */
function storeFor(state: Fixture): ReflectionReservationStore {
  return new ReflectionReservationStore({
    identity: state.identity,
    config: { stepCount: 1, onCompaction: true },
    getJournal: async (conversationId) => {
      if (conversationId !== "conversation-a") throw new Error(`unknown conversation: ${conversationId}`)
      return state.journal
    },
    createRunId: createReflectionRunIdFactory({ reflectionDir: state.paths.reflection }),
  })
}

async function manualRequest(state: Fixture) {
  const snapshot = await state.journal.captureReflectionSnapshot()
  if (snapshot === null) throw new Error("expected a reflection snapshot")
  return { trigger: "manual" as const, conversationIds: ["conversation-a"], snapshots: [{ conversationId: "conversation-a", snapshot }] }
}

/** Generation one's debris: a consumed failure record plus its run directory, as the issue found them. */
async function seedStaleGeneration(reflectionDir: string): Promise<void> {
  const completionsDir = join(reflectionDir, "completions")
  await mkdir(completionsDir, { recursive: true, mode: 0o700 })
  await mkdir(join(reflectionDir, "runs", "reflection-run-1"), { recursive: true, mode: 0o700 })
  await writeFile(join(completionsDir, "reflection-run-1.json"), `${JSON.stringify({
    schemaVersion: 1,
    runId: "reflection-run-1",
    identity: "agent-test",
    category: "quick",
    conversationIds: ["conversation-a"],
    trigger: "step-count",
    outcome: "failed",
    reason: "child_exit",
    detail: "bwrap: setting up uid map: Permission denied",
    startedAt: "2026-08-22T10:07:00.000Z",
    finishedAt: "2026-08-22T10:07:00.200Z",
    durationMs: 200,
    consecutiveFailures: 7,
    delivery: { status: "consumed" },
  }, null, 2)}\n`, "utf8")
}

describe("reflection run id collision across a counter reset", () => {
  test("#given stale generation-one records #when fresh stores reserve across a simulated restart #then no persisted run id is ever reused", async () => {
    // given
    const state = await fixture()
    await seedStaleGeneration(state.paths.reflection)

    // when
    const firstGeneration = storeFor(state)
    const first = await firstGeneration.tryReserve(await manualRequest(state))
    if (first.status !== "active") throw new Error("expected an active reservation")
    await firstGeneration.complete(first.run.runId, "no_changes")
    // The runner settle always publishes a completion record; generation one's is what wedged
    // the lane in the issue, so it must be on disk before the restart.
    await ensureReflectionCompletion(join(state.paths.reflection, "completions"), {
      schemaVersion: 1,
      runId: first.run.runId,
      identity: "agent-test",
      category: "quick",
      conversationIds: ["conversation-a"],
      trigger: "manual",
      outcome: "no_changes",
      startedAt: "2026-08-24T08:00:00.000Z",
      finishedAt: "2026-08-24T08:01:00.000Z",
      durationMs: 60_000,
      consecutiveFailures: 0,
      delivery: { status: "consumed" },
    })
    await state.journal.reconcile([{ kind: "assistant", messageId: "assistant-2", textBlocks: ["two"] }])

    const secondGeneration = storeFor(state)
    const second = await secondGeneration.tryReserve(await manualRequest(state))
    if (second.status !== "active") throw new Error("expected an active reservation")

    // then
    expect(first.run.runId).not.toBe("reflection-run-1")
    expect(second.run.runId).not.toBe("reflection-run-1")
    expect(second.run.runId).not.toBe(first.run.runId)
  })

  test("#given a new generation run #when its completion is published #then it lands beside the stale record and the stale record is untouched", async () => {
    // given
    const state = await fixture()
    await seedStaleGeneration(state.paths.reflection)
    const staleBefore = await readFile(join(state.paths.reflection, "completions", "reflection-run-1.json"), "utf8")
    const generation = storeFor(state)
    const reserved = await generation.tryReserve(await manualRequest(state))
    if (reserved.status !== "active") throw new Error("expected an active reservation")
    const completionsDir = join(state.paths.reflection, "completions")

    // when
    await ensureReflectionCompletion(completionsDir, {
      schemaVersion: 1,
      runId: reserved.run.runId,
      identity: "agent-test",
      category: "quick",
      conversationIds: ["conversation-a"],
      trigger: "manual",
      outcome: "merged",
      startedAt: "2026-08-24T09:00:00.000Z",
      finishedAt: "2026-08-24T09:01:00.000Z",
      durationMs: 60_000,
      consecutiveFailures: 0,
      delivery: { status: "pending" },
    })

    // then
    const published = JSON.parse(await readFile(
      join(completionsDir, `${reserved.run.runId}.json`),
      "utf8",
    ))
    expect(published).toMatchObject({ runId: reserved.run.runId, outcome: "merged" })
    expect(await readFile(join(completionsDir, "reflection-run-1.json"), "utf8")).toBe(staleBefore)
  })
})
