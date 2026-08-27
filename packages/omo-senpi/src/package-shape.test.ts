import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "bun:test"

import { resolveOmoBin } from "./components/ulw-loop/omo-command"

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJsonObject(path: string): Promise<JsonObject> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isJsonObject(parsed)) throw new Error(`${path} must contain a JSON object`)
  return parsed
}

function readString(record: JsonObject, key: string): string {
  const value = record[key]
  if (typeof value !== "string") throw new Error(`${key} must be a string`)
  return value
}

function readBoolean(record: JsonObject, key: string): boolean {
  const value = record[key]
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`)
  return value
}

function readStringRecord(record: JsonObject, key: string): Record<string, string> {
  const value = record[key]
  if (value === undefined) return {}
  if (!isJsonObject(value)) throw new Error(`${key} must be an object`)

  const result: Record<string, string> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") throw new Error(`${key}.${entryKey} must be a string`)
    result[entryKey] = entryValue
  }
  return result
}

function readObjectRecord(record: JsonObject, key: string): Record<string, JsonObject> {
  const value = record[key]
  if (!isJsonObject(value)) throw new Error(`${key} must be an object`)

  const result: Record<string, JsonObject> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (!isJsonObject(entryValue)) throw new Error(`${key}.${entryKey} must be an object`)
    result[entryKey] = entryValue
  }
  return result
}

function readStringArray(record: JsonObject, key: string): readonly string[] {
  const value = record[key]
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${key} must be a string array`)
  }
  return value
}

describe("omo-senpi package shape", () => {
  test("#given the senpi adapter manifest #when audited #then it declares the package contract", async () => {
    // given
    const [rootManifest, manifest] = await Promise.all([
      readJsonObject("package.json"),
      readJsonObject("packages/omo-senpi/package.json"),
    ])

    // when
    const exportsMap = readObjectRecord(manifest, "exports")
    const scripts = readStringRecord(manifest, "scripts")
    const dependencies = readStringRecord(manifest, "dependencies")
    const devDependencies = readStringRecord(manifest, "devDependencies")
    const peerDependencies = readStringRecord(manifest, "peerDependencies")
    const peerDependenciesMeta = readObjectRecord(manifest, "peerDependenciesMeta")
    const rootPatchedDependencies = readStringRecord(rootManifest, "patchedDependencies")

    // then
    expect(readString(manifest, "name")).toBe("@oh-my-opencode/omo-senpi")
    expect(readBoolean(manifest, "private")).toBe(true)
    expect(readString(manifest, "type")).toBe("module")
    expect(readString(manifest, "version")).toBe(readString(rootManifest, "version"))
    expect(Object.keys(exportsMap).toSorted()).toEqual([".", "./extension", "./install"])
    expect(scripts).toMatchObject({
      typecheck: "tsgo --noEmit -p tsconfig.json",
      test: "bun test src/**/*.test.ts",
    })
    expect(peerDependencies["@code-yeongyu/senpi"]).toBe("2026.8.27")
    expect(peerDependenciesMeta["@code-yeongyu/senpi"]).toMatchObject({ optional: true })
    expect(devDependencies["@code-yeongyu/senpi"]).toBe("2026.8.27")
    expect(rootPatchedDependencies["@code-yeongyu/senpi@2026.8.27"]).toBe(
      "patches/@code-yeongyu%2Fsenpi@2026.8.27.patch",
    )
    expect(dependencies).toMatchObject({
      "@oh-my-opencode/utils": "workspace:*",
      "@oh-my-opencode/comment-checker-core": "workspace:*",
      "@oh-my-opencode/telemetry-core": "workspace:*",
      "@oh-my-opencode/prompts-core": "workspace:*",
      "@oh-my-opencode/lsp-core": "workspace:*",
      "@code-yeongyu/lsp-daemon": "file:../lsp-daemon",
    })
    expect(Object.keys(dependencies)).not.toContain(["vscode", "jsonrpc"].join("-"))
    expect(Object.keys(readStringRecord(rootManifest, "dependencies"))).not.toContain(["vscode", "jsonrpc"].join("-"))
  })

  test("#given the packaged senpi plugin manifest #when audited #then license and notice files ship with generated artifacts", async () => {
    // given
    const manifest = await readJsonObject("packages/omo-senpi/plugin/package.json")

    // when
    const files = readStringArray(manifest, "files")

    // then
    expect(files).toContain("extensions")
    expect(files).toContain("skills")
    expect(files).toContain("runtime")
    expect(files).toContain("README.md")
    expect(files).toContain("NOTICE")
    expect(files).toContain("LICENSE")
  })

  test("#given root workspace metadata #when audited #then the senpi adapter is registered", async () => {
    // given
    const rootManifest = await readJsonObject("package.json")

    // when
    const workspaces = readStringArray(rootManifest, "workspaces")
    const devDependencies = readStringRecord(rootManifest, "devDependencies")
    const typecheckPackages = readString(readStringRecord(rootManifest, "scripts"), "typecheck:packages")

    // then
    expect(workspaces).toContain("packages/omo-senpi")
    expect(workspaces).not.toContain("packages/lsp-daemon")
    expect(devDependencies["@oh-my-opencode/omo-senpi"]).toBe("workspace:*")
    expect(typecheckPackages).toContain("tsgo --noEmit -p packages/omo-senpi/tsconfig.json")
  })

  test("#given the built senpi plugin package #when resolving its staged ulw-loop CLI and probing status #then the CLI runs without a Codex installation or session env", async () => {
    // given: the plugin-layout importer URL anchors the bundle-relative resolution rule
    // (extensions/omo.js -> ../runtime/agent-toolkit/cli.js); the staged runtime exists after
    // `bun run build:senpi-plugin`, which every senpi gate runs before this suite.
    const importerUrl = pathToFileURL(resolve("packages/omo-senpi/plugin/extensions/omo.js")).href
    const workspace = mkdtempSync(join(tmpdir(), "omo-senpi-package-shape-toolkit-"))
    try {
      // when
      const bin = resolveOmoBin({}, importerUrl)
      if (bin === null) throw new Error("the staged agent-toolkit CLI did not resolve from the plugin layout")

      // then: the pinned CLI ships inside the package and resolves with no env help at all
      expect(bin).toBe(resolve("packages/omo-senpi/plugin/runtime/agent-toolkit/cli.js"))

      const env = sanitizedToolkitEnv()
      const created = spawnSync(process.execPath, [bin, "ulw-loop", "create-goals", "--brief", "- package-shape probe goal", "--json", "--session-id", "pkgshape"], {
        cwd: workspace,
        env,
        encoding: "utf8",
        timeout: 60_000,
      })
      expect(created.status).toBe(0)

      const status = spawnSync(process.execPath, [bin, "ulw-loop", "status", "--json", "--session-id", "pkgshape"], {
        cwd: workspace,
        env,
        encoding: "utf8",
        timeout: 60_000,
      })
      expect(status.status).toBe(0)
      const parsed: unknown = JSON.parse(status.stdout)
      if (!isJsonObject(parsed)) throw new Error("status output must be a JSON object")
      expect(parsed["ok"]).toBe(true)
      const plan = parsed["plan"]
      if (!isJsonObject(plan)) throw new Error("status plan must be a JSON object")
      expect(Array.isArray(plan["goals"])).toBe(true)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

const SESSION_SCOPING_ENV_KEYS = ["OMO_ULW_LOOP_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID", "PI_SESSION_ID"] as const

function sanitizedToolkitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of SESSION_SCOPING_ENV_KEYS) delete env[key]
  return env
}
