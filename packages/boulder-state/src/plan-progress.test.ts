/// <reference path="../../../bun-test.d.ts" />

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { getPlanProgress } from "./index"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function writePlan(markdown: string): string {
  const directory = mkdtempSync(join(tmpdir(), "boulder-plan-progress-"))
  cleanupRoots.push(directory)
  const planPath = join(directory, "plan.md")
  writeFileSync(planPath, markdown, "utf-8")
  return planPath
}

describe("getPlanProgress", () => {
  test("#given structured plan sections #when progress is read #then only labeled top-level TODO and final wave tasks count", () => {
    // given
    const planPath = writePlan([
      "# Plan",
      "- [ ] Preamble checkbox",
      "## TODOs",
      "- [x] 1. Completed task",
      "  - [ ] 1.1 Nested task",
      "- [ ] Missing numeric label",
      "- [ ] 2. Remaining task",
      "## Acceptance Criteria",
      "- [ ] Ignored checkbox",
      "## Final Verification Wave",
      "- [X] F1. Verified task",
      "- [ ] F2. Remaining verification",
    ].join("\n"))

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress).toEqual({ total: 4, completed: 2, isComplete: false })
  })

  test("#given simple plan without structured headings #when progress is read #then all top-level checkboxes count", () => {
    // given
    const planPath = writePlan([
      "# Plan",
      "- [x] Completed",
      "- [ ] Remaining",
      "  - [ ] Nested ignored by simple fallback",
    ].join("\n"))

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress).toEqual({ total: 2, completed: 1, isComplete: false })
  })

  test("#given production-shaped plan with progress tracked outside boilerplate sections #when progress is read #then real totals are reported", () => {
    // given
    const planPath = writePlan([
      "# Plan",
      "## Todos",
      "Wave descriptions live here.",
      "## Final verification wave",
      "Template explanation lives here.",
      "## Progress Tracker",
      "- [x] T1.1 - tolerances schema",
      "- [~] T5.1 - verification engine - DEFERRED",
      "- [ ] F1 - plan-compliance audit",
    ].join("\n"))

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress).toEqual({ total: 3, completed: 2, isComplete: false })
  })

  test("#given every tracked row resolved or user-blocked #when progress is read #then the plan is complete", () => {
    // given
    const planPath = writePlan([
      "# Plan",
      "## Todos",
      "Wave descriptions live here.",
      "## Final verification wave",
      "Template explanation lives here.",
      "## Progress Tracker",
      "- [x] T1.1 - tolerances schema",
      "- [~] T5.1 - verification engine - BLOCKED on user decision",
    ].join("\n"))

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress).toEqual({ total: 2, completed: 2, isComplete: true })
  })

  test("#given a genuinely empty structured plan #when progress is read #then it stays incomplete", () => {
    // given
    const planPath = writePlan([
      "# Plan",
      "## Todos",
      "Describe implementation work here.",
      "## Final verification wave",
      "Describe final checks here.",
    ].join("\n"))

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress).toEqual({ total: 0, completed: 0, isComplete: false })
  })
})
