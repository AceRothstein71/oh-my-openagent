import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { loadOmoConfig, readOmoProfileState, resolveOmoProfileName } from "../index"

const PROFILE_CONFIG = `{
  "active_profile": "gpt",
  "categories": {
    "quick": { "model": "base-model" }
  },
  "profiles": {
    "gpt": { "categories": { "quick": { "model": "gpt-model" } } },
    "kimi": { "categories": { "quick": { "model": "kimi-model" } } }
  }
}`

function makeFixture(config: string, projectConfig?: string): { readonly cwd: string; readonly homeDir: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-active-profile-"))
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "work")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  writeFileSync(join(homeDir, ".omo", "omo.jsonc"), config)
  if (projectConfig !== undefined) {
    mkdirSync(join(cwd, ".omo"), { recursive: true })
    writeFileSync(join(cwd, ".omo", "omo.jsonc"), projectConfig)
  }
  return { cwd, homeDir }
}

describe("persisted active profile", () => {
  test("#given no environment activation #when resolving the profile name #then the persisted selection is used", () => {
    // given
    const options = { env: {}, persisted: "gpt" }

    // when
    const profile = resolveOmoProfileName(options)

    // then
    expect(profile).toBe("gpt")
  })

  test("#given OMO_PROFILE and a persisted selection #when resolving the profile name #then the environment wins", () => {
    // given
    const options = { env: { OMO_PROFILE: "kimi" }, persisted: "gpt" }

    // when
    const profile = resolveOmoProfileName(options)

    // then
    expect(profile).toBe("kimi")
  })

  test("#given an OPENCODE_CONFIG_DIR profile tail and a persisted selection #when resolving the profile name #then the directory tail wins", () => {
    // given
    const options = { env: { OPENCODE_CONFIG_DIR: "/does-not-exist/profiles/kimi" }, persisted: "gpt" }

    // when
    const profile = resolveOmoProfileName(options)

    // then
    expect(profile).toBe("kimi")
  })

  test("#given a config with active_profile #when loading #then the profile layer applies and the control key never leaks", () => {
    // given
    const fixture = makeFixture(PROFILE_CONFIG)

    // when
    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    // then
    expect(loaded.profile).toBe("gpt")
    expect(loaded.config.categories?.["quick"]?.model).toBe("gpt-model")
    expect(Object.keys(loaded.config)).not.toContain("active_profile")
  })

  test("#given active_profile and OMO_PROFILE #when loading #then the environment profile layer applies", () => {
    // given
    const fixture = makeFixture(PROFILE_CONFIG)

    // when
    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir, OMO_PROFILE: "kimi" } })

    // then
    expect(loaded.profile).toBe("kimi")
    expect(loaded.config.categories?.["quick"]?.model).toBe("kimi-model")
  })

  test("#given a persisted profile that does not exist #when loading #then the base config is used with a profile diagnostic", () => {
    // given
    const fixture = makeFixture(`{
      "active_profile": "missing",
      "categories": { "quick": { "model": "base-model" } },
      "profiles": { "gpt": { "categories": { "quick": { "model": "gpt-model" } } } }
    }`)

    // when
    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    // then
    expect(loaded.profile).toBeUndefined()
    expect(loaded.config.categories?.["quick"]?.model).toBe("base-model")
    expect(loaded.diagnostics.map((diagnostic) => diagnostic.kind)).toContain("profile")
  })

  test("#given a project config that sets active_profile #when loading #then it is ignored with a diagnostic and the user layer decides", () => {
    // given
    const fixture = makeFixture(PROFILE_CONFIG, `{ "active_profile": "kimi" }`)

    // when
    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    // then
    expect(loaded.profile).toBe("gpt")
    expect(loaded.config.categories?.["quick"]?.model).toBe("gpt-model")
    expect(loaded.diagnostics.some((diagnostic) => diagnostic.message.includes(`Ignoring "active_profile"`))).toBe(true)
  })

  test("#given only a project config that sets active_profile #when loading #then no profile is activated", () => {
    // given
    const fixture = makeFixture(
      `{
        "categories": { "quick": { "model": "base-model" } },
        "profiles": { "gpt": { "categories": { "quick": { "model": "gpt-model" } } } }
      }`,
      `{ "active_profile": "gpt" }`,
    )

    // when
    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    // then
    expect(loaded.profile).toBeUndefined()
    expect(loaded.config.categories?.["quick"]?.model).toBe("base-model")
  })

  test("#given no persisted profile and no environment activation #when loading #then no profile is active", () => {
    // given
    const fixture = makeFixture(`{
      "categories": { "quick": { "model": "base-model" } },
      "profiles": { "gpt": { "categories": { "quick": { "model": "gpt-model" } } } }
    }`)

    // when
    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    // then
    expect(loaded.profile).toBeUndefined()
    expect(loaded.config.categories?.["quick"]?.model).toBe("base-model")
  })
})

describe("readOmoProfileState", () => {
  test("#given defined profiles and a persisted selection #when reading state #then names are sorted and the persisted origin is reported", () => {
    // given
    const fixture = makeFixture(PROFILE_CONFIG)

    // when
    const state = readOmoProfileState({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    // then
    expect(state.profiles).toEqual(["gpt", "kimi"])
    expect(state.persisted).toBe("gpt")
    expect(state.active).toEqual({ name: "gpt", origin: "persisted" })
  })

  test("#given OMO_PROFILE over a persisted selection #when reading state #then the environment origin is reported", () => {
    // given
    const fixture = makeFixture(PROFILE_CONFIG)

    // when
    const state = readOmoProfileState({ cwd: fixture.cwd, env: { HOME: fixture.homeDir, OMO_PROFILE: "kimi" } })

    // then
    expect(state.persisted).toBe("gpt")
    expect(state.active).toEqual({ name: "kimi", origin: "OMO_PROFILE" })
  })

  test("#given a config without profiles #when reading state #then no profiles and no active selection are reported", () => {
    // given
    const fixture = makeFixture(`{ "categories": { "quick": { "model": "base-model" } } }`)

    // when
    const state = readOmoProfileState({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    // then
    expect(state.profiles).toEqual([])
    expect(state.persisted).toBeUndefined()
    expect(state.active).toBeUndefined()
  })
})
