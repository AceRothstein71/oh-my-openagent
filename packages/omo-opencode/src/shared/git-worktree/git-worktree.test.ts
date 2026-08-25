/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { formatFileChanges, parseGitDiffNumstat, parseGitStatusPorcelain } from "./index"

describe("git-worktree", () => {
  test("#given status porcelain output #when parsing #then maps paths to statuses", () => {
    const porcelain = [
      " M src/a.ts",
      "A  src/b.ts",
      "?? src/c.ts",
      "D  src/d.ts",
    ].join("\n")

    const map = parseGitStatusPorcelain(porcelain)
    expect(map.get("src/a.ts")).toBe("modified")
    expect(map.get("src/b.ts")).toBe("added")
    expect(map.get("src/c.ts")).toBe("added")
    expect(map.get("src/d.ts")).toBe("deleted")
  })

  test("#given diff numstat and status map #when parsing #then returns typed stats", () => {
    const porcelain = [" M src/a.ts", "A  src/b.ts"].join("\n")
    const statusMap = parseGitStatusPorcelain(porcelain)

    const numstat = ["1\t2\tsrc/a.ts", "3\t0\tsrc/b.ts", "-\t-\tbin.dat"].join("\n")
    const stats = parseGitDiffNumstat(numstat, statusMap)

    expect(stats).toEqual([
      { path: "src/a.ts", added: 1, removed: 2, status: "modified" },
      { path: "src/b.ts", added: 3, removed: 0, status: "added" },
      { path: "bin.dat", added: 0, removed: 0, status: "modified" },
    ])
  })

  test("#given git file stats #when formatting #then produces grouped summary", () => {
    const summary = formatFileChanges([
      { path: "src/a.ts", added: 1, removed: 2, status: "modified" },
      { path: "src/b.ts", added: 3, removed: 0, status: "added" },
      { path: "src/c.ts", added: 0, removed: 4, status: "deleted" },
    ])

    expect(summary).toContain("[FILE CHANGES SUMMARY]")
    expect(summary).toContain("Modified files:")
    expect(summary).toContain("Created files:")
    expect(summary).toContain("Deleted files:")
    expect(summary).toContain("src/a.ts")
    expect(summary).toContain("src/b.ts")
    expect(summary).toContain("src/c.ts")
  })

  test("#given notepad path #when formatting omo plan changes #then does not report notepad updated", () => {
    const summary = formatFileChanges([
      { path: ".omo/plans/work.md", added: 1, removed: 0, status: "modified" },
    ], ".omo/notepads/work/notes.md")

    expect(summary).not.toContain("[NOTEPAD UPDATED]")
  })

  test("#given notepad path #when formatting omo notepad changes #then reports notepad updated", () => {
    const summary = formatFileChanges([
      { path: ".omo/notepads/work/notes.md", added: 1, removed: 0, status: "modified" },
    ], ".omo/notepads/work/notes.md")

    expect(summary).toContain("[NOTEPAD UPDATED]")
    expect(summary).toContain(".omo/notepads/work/notes.md")
  })

  test("#given notepad path #when formatting another omo notepad change #then does not report active notepad updated", () => {
    const summary = formatFileChanges([
      { path: ".omo/notepads/other/notes.md", added: 1, removed: 0, status: "modified" },
    ], ".omo/notepads/work/notes.md")

    expect(summary).not.toContain("[NOTEPAD UPDATED]")
  })

  test("#given more than 20 files in one group #when formatting #then caps the group with a deterministic and-N-more note", () => {
    const stats = Array.from({ length: 25 }, (_, i) => ({
      path: `src/modified_${i}.ts`,
      added: 1,
      removed: 0,
      status: "modified" as const,
    }))

    const summary = formatFileChanges(stats)

    expect(summary).toContain("[FILE CHANGES SUMMARY]")
    expect(summary).toContain("src/modified_19.ts")
    expect(summary).not.toContain("src/modified_20.ts")
    expect(summary).toContain("...and 5 more modified files")
  })

  test("#given thousands of changed files #when formatting #then summary stays bounded with explicit truncation marker", () => {
    const modified = Array.from({ length: 3000 }, (_, i) => ({
      path: `pkg/module_${i}/very/long/path/component_file_name.ts`,
      added: 10,
      removed: 5,
      status: "modified" as const,
    }))
    const added = Array.from({ length: 2000 }, (_, i) => ({
      path: `new/folder_${i}/created_file.ts`,
      added: 100,
      removed: 0,
      status: "added" as const,
    }))
    const deleted = Array.from({ length: 1500 }, (_, i) => ({
      path: `old/deleted_${i}/removed_file.ts`,
      added: 0,
      removed: 50,
      status: "deleted" as const,
    }))

    const summary = formatFileChanges([...modified, ...added, ...deleted])

    expect(Buffer.byteLength(summary)).toBeLessThanOrEqual(32 * 1024)
    expect(summary).toContain("Output truncated: true")
    expect(summary).toContain("6500")
  })

  test("#given extremely long paths exceeding the byte cap #when formatting #then byte cap holds and notepad section survives", () => {
    const longSegment = "d".repeat(2000)
    const stats = [
      { path: ".omo/notepads/work/notes.md", added: 1, removed: 0, status: "modified" as const },
      ...Array.from({ length: 30 }, (_, i) => ({
        path: `${longSegment}/file_${i}.ts`,
        added: 1,
        removed: 0,
        status: "modified" as const,
      })),
    ]

    const summary = formatFileChanges(stats, ".omo/notepads/work/notes.md")

    expect(Buffer.byteLength(summary)).toBeLessThanOrEqual(32 * 1024)
    expect(summary).toContain("[NOTEPAD UPDATED]")
    expect(summary).toContain(".omo/notepads/work/notes.md")
  })
})
