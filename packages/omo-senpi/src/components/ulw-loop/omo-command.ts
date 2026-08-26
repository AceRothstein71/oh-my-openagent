import { spawn } from "node:child_process"
import { accessSync, constants, existsSync, statSync } from "node:fs"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"

const OMO_COMMAND_TIMEOUT_MS = 30_000
const SESSION_SCOPING_ENV_KEYS = ["OMO_ULW_LOOP_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID", "PI_SESSION_ID"] as const

export interface SpawnTarget {
  readonly command: string
  readonly args: readonly string[]
}

// Windows .cmd/.bat shims must be invoked through cmd.exe; Node's BatBadBut hardening
// (CVE-2024-27980, Node >= 18.20.2) throws EINVAL synchronously when spawning them
// without a shell. The `/d /s /c` prefix preserves arg quoting. `args` here are
// the fixed STATUS_ARGS constant, so cmd metacharacter injection is not a concern
// for this call site.
export function toSpawnTarget(
  bin: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): SpawnTarget {
  // .js entries spawn through the current runtime on every platform, so an
  // override (e.g. OMO_AGENT_TOOLKIT_BIN) may point at a JS entry directly.
  if (/\.js$/i.test(bin)) return { command: process.execPath, args: [bin, ...args] }
  const isWindowsScript = platform === "win32" && /\.(cmd|bat)$/i.test(bin)
  if (!isWindowsScript) return { command: bin, args }
  return { command: "cmd.exe", args: ["/d", "/s", "/c", bin, ...args] }
}

export function resolveOmoBin(
  env: Record<string, string | undefined> = process.env,
  importerUrl: string = import.meta.url,
): string | null {
  const toolkitEnvBin = env["OMO_AGENT_TOOLKIT_BIN"]?.trim()
  if (toolkitEnvBin) return toolkitEnvBin
  // The staged runtime beats PATH/OMO_BIN discovery: it is built and pinned to this exact
  // adapter build (stage-agent-toolkit.mjs), so it is always the compatible CLI when present.
  // The explicit OMO_AGENT_TOOLKIT_BIN override above still wins, e.g. the omo-native launcher
  // pins its own staged copy through it.
  const bundledCli = resolveBundledToolkitCli(importerUrl)
  if (bundledCli !== null) return bundledCli
  const toolkitOnPath = findExecutableOnPath("omo-agent-toolkit", env["PATH"])
  if (toolkitOnPath) return toolkitOnPath
  const envBin = env["OMO_BIN"]?.trim()
  if (envBin) return envBin
  // Deliberately NO PATH lookup of the bare name "omo": after the hard cutover
  // an `omo` on PATH is either a stale install of ours or the unrelated
  // third-party package, and resolving it would silently execute the wrong binary.
  return null
}

// The build stages the pinned ulw-loop CLI beside the extension bundle with the fixed layout
// plugin/extensions/omo.js -> ../runtime/agent-toolkit/cli.js. Resolving relative to this module's
// URL keeps holding after bundling because import.meta.url then points at extensions/omo.js; in
// unbundled source contexts the relative location simply does not exist and resolution falls through.
export function resolveBundledToolkitCli(importerUrl: string = import.meta.url): string | null {
  let candidate: string
  try {
    candidate = fileURLToPath(new URL("../runtime/agent-toolkit/cli.js", importerUrl))
  } catch {
    return null
  }
  const stat = statSync(candidate, { throwIfNoEntry: false })
  return stat?.isFile() === true ? candidate : null
}

export async function runOmoCommand(
  bin: string,
  args: readonly string[],
  options: { cwd: string },
): Promise<{ code: number; stdout: string }> {
  const { promise, resolve } = Promise.withResolvers<{ code: number; stdout: string }>()
  // stderr is never consumed: piping it would wedge the child forever once the
  // 64KiB pipe buffer fills (observed as thousands of live `omo-agent-toolkit ulw-loop status`
  // processes). Inherit-discard it and hard-kill the child on timeout instead.
  const target = toSpawnTarget(bin, args)
  const child = spawn(target.command, [...target.args], {
    cwd: options.cwd,
    env: sessionScopeFreeEnv(),
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  })

  const stdoutChunks: Buffer[] = []
  let settled = false
  const settle = (result: { code: number; stdout: string }): void => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    resolve(result)
  }
  const timeout = setTimeout(() => {
    child.kill("SIGKILL")
    settle({ code: 1, stdout: Buffer.concat(stdoutChunks).toString("utf8") })
  }, OMO_COMMAND_TIMEOUT_MS)
  timeout.unref?.()

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  })
  child.on("error", () => {
    settle({ code: 1, stdout: Buffer.concat(stdoutChunks).toString("utf8") })
  })
  child.on("close", (code) => {
    settle({ code: code ?? 1, stdout: Buffer.concat(stdoutChunks).toString("utf8") })
  })
  return promise
}

function findExecutableOnPath(command: string, pathValue: string | undefined): string | null {
  if (!pathValue) return null
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue
    for (const candidate of executableCandidates(directory, command)) {
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

function executableCandidates(directory: string, command: string): string[] {
  if (process.platform !== "win32") return [join(directory, command)]
  const extensions = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter((extension) => extension.length > 0)
  return [join(directory, command), ...extensions.map((extension) => join(directory, `${command}${extension.toLowerCase()}`))]
}

// Probes are always scoped with an explicit --session-id; inherited host session variables
// (e.g. CODEX_THREAD_ID when the Senpi host runs embedded in Codex Desktop) must never reach
// the toolkit as a fallback scope for state or evidence directories.
function sessionScopeFreeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of SESSION_SCOPING_ENV_KEYS) delete env[key]
  return env
}

function isExecutableFile(file: string): boolean {
  if (!existsSync(file)) return false
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}
