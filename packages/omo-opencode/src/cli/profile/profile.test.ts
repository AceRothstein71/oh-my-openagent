import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { runProfileClear, runProfileCurrent, runProfileList, runProfileUse } from "./profile"

const CONFIG_WITH_PROFILES = `{
  // keep this comment alive across writes
  "profiles": {
    "gpt": { "categories": { "quick": { "model": "gpt-model" } } },
    "kimi": { "categories": { "quick": { "model": "kimi-model" } } }
  }
}
`

type Fixture = {
  readonly configPath: string
  readonly cwd: string
  readonly environment: Record<string, string | undefined>
}

function makeFixture(config: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-profile-cli-"))
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "work")
  const configPath = join(homeDir, ".omo", "omo.jsonc")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  writeFileSync(configPath, config)
  return { configPath, cwd, environment: { HOME: homeDir } }
}

function capture(): { readonly lines: string[]; readonly write: (line: string) => void } {
  const lines: string[] = []
  return { lines, write: (line: string): void => void lines.push(line) }
}

describe("omo profile", () => {
  test("#given defined profiles and no selection #when listing #then every profile prints without an active marker", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()

    // when
    const exitCode = runProfileList({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    // then
    expect(exitCode).toBe(0)
    expect(output.lines.join("\n")).toContain("  gpt")
    expect(output.lines.join("\n")).toContain("  kimi")
    expect(output.lines.join("\n")).not.toContain("*")
  })

  test("#given no profiles in the config #when listing #then a discoverable empty-state message prints", () => {
    // given
    const fixture = makeFixture(`{}\n`)
    const output = capture()

    // when
    const exitCode = runProfileList({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    // then
    expect(exitCode).toBe(0)
    expect(output.lines.join("\n")).toContain("No profiles defined")
  })

  test("#given a defined profile #when using it #then the selection persists as active_profile and comments survive", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()

    // when
    const exitCode = runProfileUse("gpt", { cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    // then
    const written = readFileSync(fixture.configPath, "utf-8")
    expect(exitCode).toBe(0)
    expect(written).toContain(`"active_profile": "gpt"`)
    expect(written).toContain("// keep this comment alive across writes")
    expect(output.lines.join("\n")).toContain(`Activated profile "gpt"`)
  })

  test("#given OMO_PROFILE wins #when using a different profile #then the persisted write reports the post-write active selection", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()

    // when
    const exitCode = runProfileUse("gpt", {
      cwd: fixture.cwd,
      environment: { ...fixture.environment, OMO_PROFILE: "kimi" },
      output: output.write,
    })

    // then
    expect(exitCode).toBe(0)
    expect(readFileSync(fixture.configPath, "utf-8")).toContain(`"active_profile": "gpt"`)
    expect(output.lines.join("\n")).toContain(`Persisted profile "gpt"`)
    expect(output.lines.join("\n")).toContain(`Active profile remains "kimi" (from OMO_PROFILE).`)
  })

  test("#given an unknown profile name #when using it #then the command fails and leaves the config untouched", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()
    const errors = capture()

    // when
    const exitCode = runProfileUse("nope", {
      cwd: fixture.cwd,
      environment: fixture.environment,
      errorOutput: errors.write,
      output: output.write,
    })

    // then
    expect(exitCode).toBe(1)
    expect(errors.lines.join("\n")).toContain(`Unknown profile "nope"`)
    expect(errors.lines.join("\n")).toContain("gpt")
    expect(readFileSync(fixture.configPath, "utf-8")).toBe(CONFIG_WITH_PROFILES)
  })

  test("#given a persisted profile #when asking for the current profile #then the persisted origin prints", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()
    runProfileUse("gpt", { cwd: fixture.cwd, environment: fixture.environment, output: capture().write })

    // when
    const exitCode = runProfileCurrent({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    // then
    expect(exitCode).toBe(0)
    expect(output.lines.join("\n")).toContain("gpt")
    expect(output.lines.join("\n")).toContain("persisted")
  })

  test("#given OMO_PROFILE set over a persisted profile #when asking for the current profile #then the environment wins and is named", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()
    runProfileUse("gpt", { cwd: fixture.cwd, environment: fixture.environment, output: capture().write })

    // when
    const exitCode = runProfileCurrent({
      cwd: fixture.cwd,
      environment: { ...fixture.environment, OMO_PROFILE: "kimi" },
      output: output.write,
    })

    // then
    expect(exitCode).toBe(0)
    expect(output.lines.join("\n")).toContain("kimi")
    expect(output.lines.join("\n")).toContain("OMO_PROFILE")
  })

  test("#given no selection at all #when asking for the current profile #then the base-config state prints", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()

    // when
    const exitCode = runProfileCurrent({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    // then
    expect(exitCode).toBe(0)
    expect(output.lines.join("\n")).toContain("No active profile")
  })

  test("#given a persisted profile #when clearing #then active_profile is removed and current reports the base config", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()
    runProfileUse("kimi", { cwd: fixture.cwd, environment: fixture.environment, output: capture().write })

    // when
    const exitCode = runProfileClear({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    // then
    const current = capture()
    runProfileCurrent({ cwd: fixture.cwd, environment: fixture.environment, output: current.write })
    expect(exitCode).toBe(0)
    expect(readFileSync(fixture.configPath, "utf-8")).not.toContain("active_profile")
    expect(current.lines.join("\n")).toContain("No active profile")
  })

  test("#given OMO_PROFILE wins #when clearing the persisted profile #then the command reports the post-write active selection", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    runProfileUse("gpt", { cwd: fixture.cwd, environment: fixture.environment, output: capture().write })
    const output = capture()

    // when
    const exitCode = runProfileClear({
      cwd: fixture.cwd,
      environment: { ...fixture.environment, OMO_PROFILE: "kimi" },
      output: output.write,
    })

    // then
    expect(exitCode).toBe(0)
    expect(readFileSync(fixture.configPath, "utf-8")).not.toContain("active_profile")
    expect(output.lines.join("\n")).toContain(`Cleared the persisted profile "gpt"`)
    expect(output.lines.join("\n")).toContain(`Active profile remains "kimi" (from OMO_PROFILE).`)
  })

  test("#given nothing persisted #when clearing #then the command reports there is nothing to clear", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()

    // when
    const exitCode = runProfileClear({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    // then
    expect(exitCode).toBe(0)
    expect(output.lines.join("\n")).toContain("No persisted profile")
    expect(readFileSync(fixture.configPath, "utf-8")).toBe(CONFIG_WITH_PROFILES)
  })

  test("#given a persisted profile #when listing #then it carries the active marker", () => {
    // given
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()
    runProfileUse("kimi", { cwd: fixture.cwd, environment: fixture.environment, output: capture().write })

    // when
    const exitCode = runProfileList({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    // then
    expect(exitCode).toBe(0)
    expect(output.lines).toContain("* kimi")
    expect(output.lines).toContain("  gpt")
  })
})
