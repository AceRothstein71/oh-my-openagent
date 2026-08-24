import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const RUN_ID_PATTERN = /^reflection-run-(\d+)(?:\.json)?$/
const RUN_ID_TEXT_PATTERN = /reflection-run-(\d+)/g
const RUN_ID_PREFIX = "reflection-run-"
const RESERVATION_STATE_FILES = ["active.lock", "pending.json"] as const

/**
 * Mints reflection run ids the way the facts lane derives its attempt sequence: one past the
 * highest id still ON DISK, across completion records, run directories, and the live
 * reservation state alike. A per-process counter restarts at 1 on every launch, so a later
 * generation re-mints a retired id, collides with that run's durable completion record
 * ("Reflection completion record mismatch") and wedges the lane permanently. A name is handed
 * back only once no trace of it survives, which is also what makes manual cleanup effective.
 */
export function createReflectionRunIdFactory(input: {
  readonly reflectionDir: string
}): () => Promise<string> {
  let highWater = 0
  return async () => {
    for (const dir of [join(input.reflectionDir, "completions"), join(input.reflectionDir, "runs")]) {
      const names = await readdir(dir).catch(() => [] as string[])
      for (const name of names) {
        const parsed = Number(RUN_ID_PATTERN.exec(name)?.[1] ?? Number.NaN)
        if (Number.isInteger(parsed) && parsed > highWater) highWater = parsed
      }
    }
    for (const name of RESERVATION_STATE_FILES) {
      const contents = await readFile(join(input.reflectionDir, name), "utf8").catch(() => "")
      for (const match of contents.matchAll(RUN_ID_TEXT_PATTERN)) {
        const parsed = Number(match[1])
        if (Number.isInteger(parsed) && parsed > highWater) highWater = parsed
      }
    }
    highWater += 1
    return `${RUN_ID_PREFIX}${highWater}`
  }
}
