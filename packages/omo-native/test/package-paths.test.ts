import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { resolveClaudeNativeBinary } from "../bin/lib/package-paths.js"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(path: string, content = "binary\n"): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function platformPackageDirName(platform: string, arch: string, variant = ""): string {
  return `claude-agent-sdk-${platform}-${arch}${variant}`
}

function installClaudeBinary(modulesRoot: string, platform: string, arch: string, variant = ""): string {
  const pkgDir = join(modulesRoot, "@anthropic-ai", platformPackageDirName(platform, arch, variant))
  const ext = platform === "win32" ? ".exe" : ""
  const binaryPath = join(pkgDir, `claude${ext}`)
  writeFile(join(pkgDir, "package.json"), JSON.stringify({
    name: `@anthropic-ai/${platformPackageDirName(platform, arch, variant)}`,
    version: "0.3.220",
  }))
  writeFile(binaryPath)
  return binaryPath
}

// npm's default global shape: every dependency lands in ONE shared node_modules next to omo-ai,
// so the engine package has no private node_modules of its own.
function hoistedEngineTree(): { modulesRoot: string; senpiRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-package-paths-hoisted-"))
  roots.push(root)
  const modulesRoot = join(root, "lib", "node_modules")
  const senpiRoot = join(modulesRoot, "@code-yeongyu", "senpi")
  writeFile(join(senpiRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi",
    version: "2026.8.23",
  }))
  return { modulesRoot, senpiRoot }
}

// bun's global shape: dependencies nest inside omo-ai/node_modules, giving the engine package a
// private node_modules that holds the optional platform packages.
function nestedEngineTree(): { modulesRoot: string; senpiRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-package-paths-nested-"))
  roots.push(root)
  const modulesRoot = join(root, "global", "node_modules", "omo-ai", "node_modules")
  const senpiRoot = join(modulesRoot, "@code-yeongyu", "senpi")
  writeFile(join(senpiRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi",
    version: "2026.8.23",
  }))
  return { modulesRoot, senpiRoot }
}

describe("resolveClaudeNativeBinary", () => {
  describe("#given a hoisted global install with the binary in the parent node_modules", () => {
    describe("#when the resolver runs from the engine package root", () => {
      test("#then it finds the parent-level binary without any package-local node_modules", () => {
        const { modulesRoot, senpiRoot } = hoistedEngineTree()
        const binaryPath = installClaudeBinary(modulesRoot, "darwin", "arm64")

        const resolved = resolveClaudeNativeBinary({ senpiRoot, env: {}, platform: "darwin", arch: "arm64" })

        expect(resolved).toEqual({ path: binaryPath, source: "engine-tree" })
      })
    })
  })

  describe("#given a nested global install with the binary under the engine's private node_modules", () => {
    describe("#when the resolver runs", () => {
      test("#then it still resolves the nested binary first", () => {
        const { modulesRoot, senpiRoot } = nestedEngineTree()
        const binaryPath = installClaudeBinary(join(senpiRoot, "node_modules"), "darwin", "arm64")

        const resolved = resolveClaudeNativeBinary({ senpiRoot, env: {}, platform: "darwin", arch: "arm64" })

        expect(resolved).toEqual({ path: binaryPath, source: "engine-tree" })
      })
    })
  })

  describe("#given CLAUDE_CODE_EXECUTABLE points at an existing binary", () => {
    describe("#when the resolver runs against a tree that also ships the binary", () => {
      test("#then the explicit override wins over the engine tree", () => {
        const { modulesRoot, senpiRoot } = hoistedEngineTree()
        installClaudeBinary(modulesRoot, "darwin", "arm64")
        const overridePath = installClaudeBinary(join(dirname(modulesRoot), "override"), "darwin", "arm64")

        const resolved = resolveClaudeNativeBinary({
          senpiRoot,
          env: { CLAUDE_CODE_EXECUTABLE: overridePath },
          platform: "darwin",
          arch: "arm64",
        })

        expect(resolved).toEqual({ path: overridePath, source: "override" })
      })
    })
  })

  describe("#given CLAUDE_CODE_EXECUTABLE points at a missing file", () => {
    describe("#when the resolver runs", () => {
      test("#then it fails and names both the variable and the broken path", () => {
        const { senpiRoot } = hoistedEngineTree()

        expect(() => resolveClaudeNativeBinary({
          senpiRoot,
          env: { CLAUDE_CODE_EXECUTABLE: "/no/such/claude" },
          platform: "darwin",
          arch: "arm64",
        })).toThrow(/CLAUDE_CODE_EXECUTABLE.*\/no\/such\/claude/)
      })
    })
  })

  describe("#given the binary is absent from every node_modules level", () => {
    describe("#when the resolver runs", () => {
      test("#then it throws an actionable error naming the reinstall command and the override", () => {
        const { senpiRoot } = hoistedEngineTree()

        expect(() => resolveClaudeNativeBinary({ senpiRoot, env: {}, platform: "darwin", arch: "arm64" }))
          .toThrow(/CLAUDE_CODE_EXECUTABLE/)
        expect(() => resolveClaudeNativeBinary({ senpiRoot, env: {}, platform: "darwin", arch: "arm64" }))
          .toThrow(/omo-ai@beta/)
      })
    })
  })

  describe("#given linux with only the musl platform package installed", () => {
    describe("#when the resolver runs", () => {
      test("#then the musl candidate is reached after glibc misses", () => {
        const { modulesRoot, senpiRoot } = hoistedEngineTree()
        const binaryPath = installClaudeBinary(modulesRoot, "linux", "x64", "-musl")

        const resolved = resolveClaudeNativeBinary({ senpiRoot, env: {}, platform: "linux", arch: "x64" })

        expect(resolved).toEqual({ path: binaryPath, source: "engine-tree" })
      })
    })
  })
})
