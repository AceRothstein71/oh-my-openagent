import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

describe("Senpi comment-checker runner", () => {
  it("#given a checker that exits during a large stdin write #when Node runs the adapter #then it does not terminate from an unhandled EPIPE", () => {
    // given
    const outputDirectory = mkdtempSync(join(tmpdir(), "omo-senpi-comment-checker-"))
    const runnerBundlePath = join(outputDirectory, "runner.mjs")
    const runnerSourcePath = fileURLToPath(new URL("./runner.ts", import.meta.url))

    try {
      const build = spawnSync(
        "bun",
        [
          "build",
          runnerSourcePath,
          "--target=node",
          "--format=esm",
          `--outfile=${runnerBundlePath}`,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      )
      expect(build.status).toBe(0)

      const runAdapter = [
        `import { defaultRunCommentChecker } from ${JSON.stringify(pathToFileURL(runnerBundlePath).href)}`,
        "await defaultRunCommentChecker({",
        "  binaryPath: process.execPath,",
        "  hookInput: {",
        '    session_id: "session-1",',
        '    tool_name: "write",',
        '    transcript_path: "",',
        `    cwd: ${JSON.stringify(process.cwd())},`,
        '    hook_event_name: "PostToolUse",',
        "    tool_input: {",
        '      file_path: "src/example.ts",',
        '      content: "x".repeat(16 * 1024 * 1024),',
        "    },",
        "  },",
        "})",
      ].join("\n")

      // when
      const run = spawnSync(process.execPath, ["--input-type=module", "--eval", runAdapter], {
        cwd: process.cwd(),
        encoding: "utf8",
      })

      // then
      expect(run.status).toBe(0)
      expect(run.stderr).toBe("")
    } finally {
      rmSync(outputDirectory, { force: true, recursive: true })
    }
  })

  it("#given a checker that exits 2 before reading stdin #when stdin reports EPIPE first #then it preserves checker feedback", () => {
    // given
    const outputDirectory = mkdtempSync(join(tmpdir(), "omo-senpi-comment-checker-"))
    const runnerBundlePath = join(outputDirectory, "runner.mjs")
    const runnerSourcePath = fileURLToPath(new URL("./runner.ts", import.meta.url))
    writeFileSync(
      join(outputDirectory, "check"),
      'process.stderr.write("line 1: redundant comment\\r\\nline 2: stale comment"); process.exit(2)',
    )

    try {
      const build = spawnSync(
        "bun",
        [
          "build",
          runnerSourcePath,
          "--target=node",
          "--format=esm",
          `--outfile=${runnerBundlePath}`,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      )
      expect(build.status).toBe(0)

      const runAdapter = [
        `import { defaultRunCommentChecker } from ${JSON.stringify(pathToFileURL(runnerBundlePath).href)}`,
        "const result = await defaultRunCommentChecker({",
        "  binaryPath: process.execPath,",
        "  hookInput: {",
        '    session_id: "session-1",',
        '    tool_name: "write",',
        '    transcript_path: "",',
        `    cwd: ${JSON.stringify(outputDirectory)},`,
        '    hook_event_name: "PostToolUse",',
        "    tool_input: {",
        '      file_path: "src/example.ts",',
        '      content: "x".repeat(16 * 1024 * 1024),',
        "    },",
        "  },",
        "})",
        "console.log(JSON.stringify(result))",
      ].join("\n")

      // when
      const run = spawnSync(process.execPath, ["--input-type=module", "--eval", runAdapter], {
        cwd: outputDirectory,
        encoding: "utf8",
      })

      // then
      expect(run.status).toBe(0)
      expect(run.stderr).toBe("")
      expect(JSON.parse(run.stdout)).toEqual({
        hasComments: true,
        message: "line 1: redundant comment\nline 2: stale comment",
      })
    } finally {
      rmSync(outputDirectory, { force: true, recursive: true })
    }
  })
})
