import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join, parse } from "node:path"
import { fileURLToPath } from "node:url"

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url))

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

export function packageManifest() {
  return readJson(join(packageRoot, "package.json"))
}

function quotePosix(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function updateTarget(root = packageRoot, platform = process.platform) {
  const updateCwd = dirname(join(root, "package.json"))
  const normalizedRoot = updateCwd.replaceAll("\\", "/")
  if (normalizedRoot.endsWith("/install/global/node_modules/omo-ai")) {
    const quotedCwd = platform === "win32"
      ? `"${normalizedRoot}"`
      : quotePosix(updateCwd)
    return {
      manager: "bun",
      command: `bun add --cwd ${quotedCwd} -g omo-ai@beta`,
    }
  }
  return { manager: "npm", command: "npm i -g omo-ai@beta" }
}

export function resolveSenpi() {
  let indexPath
  try {
    indexPath = fileURLToPath(import.meta.resolve("@code-yeongyu/senpi"))
  } catch (error) {
    throw new Error(`could not resolve @code-yeongyu/senpi; reinstall with: ${updateTarget().command} (${error.message})`)
  }

  const cliPath = join(dirname(indexPath), "cli.js")
  if (!existsSync(cliPath)) {
    throw new Error(`senpi CLI is missing at ${cliPath}; reinstall with: ${updateTarget().command}`)
  }
  return { cliPath, packageRoot: dirname(dirname(indexPath)) }
}

function isMuslLinuxRuntime(platform) {
  if (platform !== "linux" || typeof process.report?.getReport !== "function") return false
  const report = process.report.getReport()
  if (report === null || typeof report !== "object" || !("header" in report)) return false
  const header = report.header
  return typeof header !== "object" || header === null || header.glibcVersionRuntime === undefined
}

// Mirrors the engine's claudeCodeExecutableCandidates so diagnostics name exactly the binary a
// turn would spawn.
function claudeNativeBinaryCandidates(platform, arch, preferMusl) {
  const ext = platform === "win32" ? ".exe" : ""
  if (platform === "linux") {
    const glibc = `@anthropic-ai/claude-agent-sdk-linux-${arch}/claude${ext}`
    const musl = `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl/claude${ext}`
    return preferMusl ? [musl, glibc] : [glibc, musl]
  }
  return [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude${ext}`]
}

export function resolveClaudeNativeBinary(options = {}) {
  const {
    senpiRoot = resolveSenpi().packageRoot,
    env = process.env,
    platform = process.platform,
    arch = process.arch,
    preferMusl = isMuslLinuxRuntime(platform),
  } = options

  const override = env.CLAUDE_CODE_EXECUTABLE
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`CLAUDE_CODE_EXECUTABLE points at ${override}, which does not exist; fix the path or unset it to fall back to the engine tree`)
    }
    return { path: override, source: "override" }
  }

  // Rooting resolution at the engine package lets Node's own ancestor walk cover hoisted global
  // layouts, where platform packages land in the parent node_modules instead of omo-ai/node_modules.
  const engineRequire = createRequire(join(senpiRoot, "package.json"))
  for (const candidate of claudeNativeBinaryCandidates(platform, arch, preferMusl)) {
    try {
      return { path: engineRequire.resolve(candidate), source: "engine-tree" }
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `Claude native binary not found for ${platform}-${arch} under the pinned engine at ${senpiRoot}; `
    + `reinstall with: ${updateTarget().command}, or set CLAUDE_CODE_EXECUTABLE to the claude binary inside @anthropic-ai/claude-agent-sdk-${platform}-${arch}`,
  )
}

export function nearestNodeBin(startPath) {
  // Hoisted layouts place the engine package inside a shared node_modules (…/node_modules/senpi),
  // whose .bin is a sibling, not a child - starting the climb inside node_modules would walk to the
  // filesystem root and never find it. Begin at the package's parent so that sibling .bin is seen.
  let current = basename(startPath) === "node_modules" ? dirname(startPath)
    : basename(dirname(startPath)) === "node_modules" ? dirname(dirname(startPath))
    : startPath
  const root = parse(current).root
  while (true) {
    const candidate = join(current, "node_modules", ".bin")
    if (existsSync(candidate)) return candidate
    if (current === root) return undefined
    current = dirname(current)
  }
}
