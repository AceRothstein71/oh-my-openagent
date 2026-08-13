import { describe, expect, test } from "bun:test"
import { readFile, readdir } from "node:fs/promises"
import { extname, join } from "node:path"

const packageRoot = join(import.meta.dir, "..")

describe("senpi-task model-core boundary", () => {
  test("#given the package manifest #when dependencies are audited #then model-core is not a runtime dependency", async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
      readonly dependencies?: Readonly<Record<string, string>>
    }

    expect(manifest.dependencies?.["@oh-my-opencode/model-core"]).toBeUndefined()
  })

  test("#given the Senpi task sources #when imports are audited #then no source imports model-core", async () => {
    const sourceFiles = await collectTypeScriptFiles(join(packageRoot, "src"))
    const offenders: string[] = []
    for (const file of sourceFiles) {
      if ((await readFile(file, "utf8")).includes("@oh-my-opencode/model-core")) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })
})

async function collectTypeScriptFiles(directory: string): Promise<readonly string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectTypeScriptFiles(path))
    else if (extname(entry.name) === ".ts" && !entry.name.endsWith(".test.ts")) files.push(path)
  }
  return files
}
