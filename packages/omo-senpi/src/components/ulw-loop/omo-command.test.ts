import { describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { resolveOmoBin, runOmoCommand, toSpawnTarget } from "./omo-command"

describe("omo-senpi ulw-loop omo-command spawn target", () => {
  it("#given a .cmd bin on win32 #when building the spawn target #then it wraps with cmd.exe /d /s /c", () => {
    const target = toSpawnTarget(
      "C:\\Users\\u\\.local\\bin\\omo.cmd",
      ["ulw-loop", "status", "--json"],
      "win32",
    )

    expect(target.command).toBe("cmd.exe")
    expect(target.args).toEqual([
      "/d",
      "/s",
      "/c",
      "C:\\Users\\u\\.local\\bin\\omo.cmd",
      "ulw-loop",
      "status",
      "--json",
    ])
  })

  it("#given an uppercase .BAT bin on win32 #when building the spawn target #then it still wraps", () => {
    const target = toSpawnTarget("D:\\tools\\OMO.BAT", ["--version"], "win32")

    expect(target.command).toBe("cmd.exe")
    expect(target.args).toEqual(["/d", "/s", "/c", "D:\\tools\\OMO.BAT", "--version"])
  })

  it("#given an .exe bin on win32 #when building the spawn target #then it spawns directly without cmd.exe", () => {
    const target = toSpawnTarget("C:\\bin\\omo.exe", ["status"], "win32")

    expect(target.command).toBe("C:\\bin\\omo.exe")
    expect(target.args).toEqual(["status"])
  })

  it("#given a plain bin on darwin #when building the spawn target #then it is unchanged", () => {
    const target = toSpawnTarget("/usr/local/bin/omo-agent-toolkit", ["ulw-loop", "status", "--json"], "darwin")

    expect(target).toEqual({
      command: "/usr/local/bin/omo-agent-toolkit",
      args: ["ulw-loop", "status", "--json"],
    })
  })

  it("#given a .cmd-looking path on non-win32 #when building the spawn target #then it is NOT wrapped (win32-only guard)", () => {
    const target = toSpawnTarget("/home/u/omo.cmd", ["status"], "linux")

    expect(target.command).toBe("/home/u/omo.cmd")
    expect(target.args).toEqual(["status"])
  })
})

describe("omo-senpi ulw-loop omo-command .js spawn target", () => {
  it("#given a .js target on win32 #when building the spawn target #then it spawns via process.execPath with the target as argv1", () => {
    const target = toSpawnTarget(
      "C:\\tools\\omo-agent-toolkit.js",
      ["ulw-loop", "status", "--json"],
      "win32",
    )

    expect(target.command).toBe(process.execPath)
    expect(target.args).toEqual(["C:\\tools\\omo-agent-toolkit.js", "ulw-loop", "status", "--json"])
  })

  it("#given a .js target on darwin #when building the spawn target #then it spawns via process.execPath", () => {
    const target = toSpawnTarget("/usr/local/lib/omo-agent-toolkit.js", ["--version"], "darwin")

    expect(target.command).toBe(process.execPath)
    expect(target.args).toEqual(["/usr/local/lib/omo-agent-toolkit.js", "--version"])
  })

  it("#given a .js target with the default platform #when building the spawn target #then it spawns via process.execPath", () => {
    const target = toSpawnTarget("/opt/omo/bin/oh-my-opencode.js", ["doctor"])

    expect(target.command).toBe(process.execPath)
    expect(target.args).toEqual(["/opt/omo/bin/oh-my-opencode.js", "doctor"])
  })

  it("#given an uppercase .JS target on win32 #when building the spawn target #then it still spawns via process.execPath", () => {
    const target = toSpawnTarget("D:\\tools\\OMO-AGENT-TOOLKIT.JS", ["status"], "win32")

    expect(target.command).toBe(process.execPath)
    expect(target.args).toEqual(["D:\\tools\\OMO-AGENT-TOOLKIT.JS", "status"])
  })
})

describe("omo-senpi ulw-loop omo-command bundled toolkit resolution", () => {
  it("#given a staged runtime beside a bundle-layout importer #when resolving with a clean env #then the bundled CLI is resolved", async () => {
    // given
    const pluginDir = await mkdtemp(join(tmpdir(), "omo-senpi-bundled-toolkit-"))
    try {
      await mkdir(join(pluginDir, "extensions"), { recursive: true })
      await mkdir(join(pluginDir, "runtime", "agent-toolkit"), { recursive: true })
      await writeFile(join(pluginDir, "extensions", "omo.js"), "")
      const stagedCli = join(pluginDir, "runtime", "agent-toolkit", "cli.js")
      await writeFile(stagedCli, "")
      const importerUrl = pathToFileURL(join(pluginDir, "extensions", "omo.js")).href

      // when
      const resolved = resolveOmoBin({}, importerUrl)

      // then
      expect(resolved).toBe(stagedCli)
    } finally {
      await rm(pluginDir, { recursive: true, force: true })
    }
  })

  it("#given a staged runtime and an explicit OMO_AGENT_TOOLKIT_BIN override #when resolving #then the explicit override still wins", async () => {
    // given
    const pluginDir = await mkdtemp(join(tmpdir(), "omo-senpi-bundled-toolkit-"))
    try {
      await mkdir(join(pluginDir, "extensions"), { recursive: true })
      await mkdir(join(pluginDir, "runtime", "agent-toolkit"), { recursive: true })
      await writeFile(join(pluginDir, "extensions", "omo.js"), "")
      await writeFile(join(pluginDir, "runtime", "agent-toolkit", "cli.js"), "")
      const importerUrl = pathToFileURL(join(pluginDir, "extensions", "omo.js")).href

      // when
      const resolved = resolveOmoBin({ OMO_AGENT_TOOLKIT_BIN: "/custom/omo-agent-toolkit" }, importerUrl)

      // then
      expect(resolved).toBe("/custom/omo-agent-toolkit")
    } finally {
      await rm(pluginDir, { recursive: true, force: true })
    }
  })

  it("#given no staged runtime at the importer-relative location #when resolving with an env override #then resolution falls through to the override", async () => {    // given
    const pluginDir = await mkdtemp(join(tmpdir(), "omo-senpi-bundled-toolkit-"))
    try {
      await mkdir(join(pluginDir, "extensions"), { recursive: true })
      const importerUrl = pathToFileURL(join(pluginDir, "extensions", "omo.js")).href

      // when
      const resolved = resolveOmoBin({ OMO_BIN: "/opt/omo/bin/omo-agent-toolkit" }, importerUrl)

      // then
      expect(resolved).toBe("/opt/omo/bin/omo-agent-toolkit")
    } finally {
      await rm(pluginDir, { recursive: true, force: true })
    }
  })

  it("#given no staged runtime and no overrides #when resolving with a clean env and empty PATH #then no bin is resolved", async () => {
    // given
    const pluginDir = await mkdtemp(join(tmpdir(), "omo-senpi-bundled-toolkit-"))
    try {
      await mkdir(join(pluginDir, "extensions"), { recursive: true })
      const importerUrl = pathToFileURL(join(pluginDir, "extensions", "omo.js")).href

      // when
      const resolved = resolveOmoBin({ PATH: "" }, importerUrl)

      // then
      expect(resolved).toBeNull()
    } finally {
      await rm(pluginDir, { recursive: true, force: true })
    }
  })
})

describe("omo-senpi ulw-loop omo-command child env hygiene", () => {
  it("#given inherited session-scoping env #when running the command #then the child sees none of the session keys", async () => {
    // given
    const previous = {
      OMO_ULW_LOOP_SESSION_ID: process.env["OMO_ULW_LOOP_SESSION_ID"],
      CODEX_SESSION_ID: process.env["CODEX_SESSION_ID"],
      CODEX_THREAD_ID: process.env["CODEX_THREAD_ID"],
      PI_SESSION_ID: process.env["PI_SESSION_ID"],
    }
    process.env["OMO_ULW_LOOP_SESSION_ID"] = "poisoned-omo"
    process.env["CODEX_SESSION_ID"] = "poisoned-codex-session"
    process.env["CODEX_THREAD_ID"] = "poisoned-codex-thread"
    process.env["PI_SESSION_ID"] = "poisoned-pi"
    const probe =
      'process.stdout.write(JSON.stringify(["OMO_ULW_LOOP_SESSION_ID","CODEX_SESSION_ID","CODEX_THREAD_ID","PI_SESSION_ID"].filter((key) => key in process.env)))'
    try {
      // when
      const result = await runOmoCommand(process.execPath, ["-e", probe], { cwd: tmpdir() })

      // then
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual([])
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
