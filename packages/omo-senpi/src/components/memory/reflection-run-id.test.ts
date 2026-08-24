import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createReflectionRunIdFactory } from "./reflection-run-id"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

async function fixture(): Promise<string> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-run-id-")))
  roots.push(root)
  return join(root, "reflection")
}

describe("disk-scoped reflection run ids", () => {
  test("#given completion records and run directories left by an earlier generation #when a fresh process mints ids #then they continue above every persisted id", async () => {
    // given
    const reflectionDir = await fixture()
    const completionsDir = join(reflectionDir, "completions")
    const runsDir = join(reflectionDir, "runs")
    await mkdir(completionsDir, { recursive: true, mode: 0o700 })
    await mkdir(join(runsDir, "reflection-run-7"), { recursive: true, mode: 0o700 })
    await writeFile(join(completionsDir, "reflection-run-13.json"), "{}\n", "utf8")

    // when
    const firstProcess = createReflectionRunIdFactory({ reflectionDir })
    const first = await firstProcess()
    await writeFile(join(completionsDir, `${first}.json`), "{}\n", "utf8")
    const secondProcess = createReflectionRunIdFactory({ reflectionDir })
    const second = await secondProcess()

    // then
    expect(first).toBe("reflection-run-14")
    expect(second).toBe("reflection-run-15")
  })

  test("#given no reflection state on disk #when the first id is minted #then numbering starts at one", async () => {
    // given
    const reflectionDir = await fixture()

    // when
    const id = await createReflectionRunIdFactory({ reflectionDir })()

    // then
    expect(id).toBe("reflection-run-1")
  })

  test("#given names in the scanned directories that are not run ids #when minting #then they are ignored", async () => {
    // given
    const reflectionDir = await fixture()
    const completionsDir = join(reflectionDir, "completions")
    const runsDir = join(reflectionDir, "runs")
    await mkdir(completionsDir, { recursive: true, mode: 0o700 })
    await mkdir(runsDir, { recursive: true, mode: 0o700 })
    await writeFile(join(completionsDir, "not-a-run.json"), "{}\n", "utf8")
    await writeFile(join(completionsDir, "reflection-run-notanumber.json"), "{}\n", "utf8")
    await mkdir(join(runsDir, "reflection-run-4"), { recursive: true, mode: 0o700 })

    // when
    const id = await createReflectionRunIdFactory({ reflectionDir })()

    // then
    expect(id).toBe("reflection-run-5")
  })

  test("#given a live reservation holding a run id no artifact records yet #when minting #then the live id is skipped too", async () => {
    // given
    const reflectionDir = await fixture()
    await mkdir(reflectionDir, { recursive: true, mode: 0o700 })
    await writeFile(join(reflectionDir, "active.lock"), `${JSON.stringify({
      runId: "reflection-run-9",
      request: { trigger: "step-count", conversationIds: ["conversation-a"], snapshots: [] },
      reservedAt: "2026-08-24T09:00:00.000Z",
    })}\n`, "utf8")

    // when
    const id = await createReflectionRunIdFactory({ reflectionDir })()

    // then
    expect(id).toBe("reflection-run-10")
  })

  test("#given repeated mints within one process #when nothing new lands on disk between them #then ids stay strictly increasing", async () => {
    // given
    const reflectionDir = await fixture()
    const mint = createReflectionRunIdFactory({ reflectionDir })

    // when
    const ids = [await mint(), await mint(), await mint()]

    // then
    expect(ids).toEqual(["reflection-run-1", "reflection-run-2", "reflection-run-3"])
  })
})
