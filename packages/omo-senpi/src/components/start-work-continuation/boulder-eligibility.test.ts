import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { findContinuableBoulderWork } from "./boulder-eligibility"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "senpi-boulder-eligibility-"))
  cleanupRoots.push(root)
  mkdirSync(join(root, ".omo", "plans"), { recursive: true })
  writeFileSync(join(root, ".omo", "plans", "t.md"), "## TODOs\n- [ ] 1. Task one\n")
  return root
}

function writeBoulder(root: string, status: string): void {
  writeFileSync(
    join(root, ".omo", "boulder.json"),
    JSON.stringify({
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: ["senpi:qa-s1"],
          status,
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    }),
  )
}

describe("findContinuableBoulderWork", () => {
  it("#given status active #when queried #then returns the work", () => {
    const root = createWorkspace()
    writeBoulder(root, "active")
    expect(findContinuableBoulderWork(root, "qa-s1")).not.toBeNull()
  })

  it("#given status paused #when queried #then returns null (issue #6752 repro 1)", () => {
    // Paused work MUST NOT be continuable. This mirrors the OpenCode
    // stop-continuation-guard contract: only status === "active" is eligible for
    // the automatic agent_end continuation injection.
    const root = createWorkspace()
    writeBoulder(root, "paused")
    expect(findContinuableBoulderWork(root, "qa-s1")).toBeNull()
  })

  it("#given status completed #when queried #then returns null", () => {
    const root = createWorkspace()
    writeBoulder(root, "completed")
    expect(findContinuableBoulderWork(root, "qa-s1")).toBeNull()
  })

  it("#given status abandoned #when queried #then returns null", () => {
    const root = createWorkspace()
    writeBoulder(root, "abandoned")
    expect(findContinuableBoulderWork(root, "qa-s1")).toBeNull()
  })

  it("#given no boulder state #when queried #then returns null", () => {
    const root = createWorkspace()
    expect(findContinuableBoulderWork(root, "qa-s1")).toBeNull()
  })
})
