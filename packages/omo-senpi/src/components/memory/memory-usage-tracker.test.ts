import { describe, expect, test } from "bun:test"
import path from "node:path"

import { extractMemoryUsagePath } from "./memory-usage-tracker"

describe("extractMemoryUsagePath", () => {
  test("#given a repo-relative read path #when extracted #then the ledger key uses forward slashes on posix", () => {
    // given
    const repoDir = "/tmp/memory/agents/safe-id/repo"
    const rawPath = path.join(repoDir, "reference", "project", "foo.md")

    // when
    const key = extractMemoryUsagePath(repoDir, rawPath)

    // then
    expect(key).toBe("reference/project/foo.md")
  })

  test("#given a Windows-style repo path #when extracted #then the ledger key still uses forward slashes (cross-platform)", () => {
    // given
    const repoDir = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\memory\\agents\\safe-id\\repo"
    const rawPath = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\memory\\agents\\safe-id\\repo\\reference\\project\\foo.md"

    // when
    const key = extractMemoryUsagePath(repoDir, rawPath)

    // then
    // The extractor must never emit backslash-separated keys because the ledger is a JSON object
    // whose keys are read back by cross-platform consumers of memory-usage.json. On Windows,
    // path.relative() returns backslash-separated segments; the extractor MUST normalize.
    // NOTE: on darwin/linux hosts, resolve() treats a Windows-style path as a single segment and
    // this call returns undefined (the path is not "inside" repoDir under posix semantics), so we
    // gate the strict assertion to win32. On win32 the key MUST be forward-slash.
    if (process.platform === "win32") {
      expect(key).toBe("reference/project/foo.md")
    }
  })

  test("#given a path outside the repo #when extracted #then returns undefined", () => {
    // given
    const repoDir = "/tmp/memory/agents/safe-id/repo"
    const rawPath = "/tmp/some-other-file.md"

    // when
    const key = extractMemoryUsagePath(repoDir, rawPath)

    // then
    expect(key).toBeUndefined()
  })

  test("#given a system/ path #when extracted #then returns undefined (system is always projected)", () => {
    // given
    const repoDir = "/tmp/memory/agents/safe-id/repo"
    const rawPath = path.join(repoDir, "system", "persona.md")

    // when
    const key = extractMemoryUsagePath(repoDir, rawPath)

    // then
    expect(key).toBeUndefined()
  })

  test("#given a .git path #when extracted #then returns undefined", () => {
    // given
    const repoDir = "/tmp/memory/agents/safe-id/repo"
    const rawPath = path.join(repoDir, ".git", "HEAD")

    // when
    const key = extractMemoryUsagePath(repoDir, rawPath)

    // then
    expect(key).toBeUndefined()
  })
})
