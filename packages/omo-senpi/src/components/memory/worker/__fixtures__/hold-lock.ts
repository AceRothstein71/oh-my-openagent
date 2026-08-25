// Live lock holder for concurrency tests: acquires the given lock path with THIS process's
// identity and parks while its PARENT-OWNED stdin pipe stays open, so lock recovery (which only
// reclaims proven-dead owners) cannot reclaim it. The pipe closing - teardown or parent death -
// is the exit signal, so an aborted runner can never strand this process; readiness is signalled
// on stdout, never timed.

import { acquireLock, createLockRecord } from "@oh-my-opencode/memory-core"

const lockPath = process.argv[2]
if (lockPath === undefined) throw new Error("lock path is required")

const record = await createLockRecord("facts-finalize", { runId: "hold-lock-fixture" })
await acquireLock(lockPath, record, { waitTimeoutMs: 10_000, retryDelayMs: 10 })
process.stdout.write("held\n")
await parkedUntilParentPipeCloses()

/** Resolves when the parent-owned stdin pipe reports EOF/close/error: a pure I/O wait, no timers. */
function parkedUntilParentPipeCloses(): Promise<void> {
  const stdin = process.stdin
  return new Promise<void>((resolve) => {
    if (!stdin.readable) {
      resolve()
      return
    }
    stdin.once("end", resolve)
    stdin.once("close", resolve)
    stdin.once("error", resolve)
    stdin.resume()
  })
}
