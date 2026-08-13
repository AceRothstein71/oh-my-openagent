#!/usr/bin/env node
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const providerEntry = join(scriptDir, "openai-recommendations-mock-provider.ts")
const capturesFile = "openai-recommendation-captures.jsonl"
const realAgentDirs = [
  join(homedir(), ".omo", "agent"),
  join(homedir(), ".senpi", "agent"),
]
const realOmoDir = join(homedir(), ".omo")

const automaticExpectations = {
  artistry: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  writing: { model: "openai/gpt-5.6-sol", variant: "medium" },
  "visual-engineering": { model: "openai/gpt-5.6-sol", variant: "high" },
  quick: { model: "openai/gpt-5.6-luna-fast", variant: undefined },
}

const automaticAgentExpectations = {
  explore: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
  librarian: { model: "openai/gpt-5.6-luna-fast", variant: "low" },
}

const scenarios = [
  {
    name: "automatic",
    config: undefined,
    parentSteps: [
      ...Object.keys(automaticExpectations).map((category) => ({
        type: "tool_call",
        name: "task",
        arguments: {
          category,
          prompt: `run the ${category} recommendation QA child`,
          run_in_background: false,
        },
      })),
      ...Object.keys(automaticAgentExpectations).map((subagentType) => ({
        type: "tool_call",
        name: "task",
        arguments: {
          subagent_type: subagentType,
          prompt: `run the ${subagentType} recommendation QA child`,
          run_in_background: false,
        },
      })),
      {
        type: "tool_call",
        name: "task",
        arguments: {
          category: "architect",
          prompt: "this child must remain unavailable without Fable 5",
          run_in_background: false,
        },
      },
      { type: "text", text: "automatic recommendation QA complete" },
    ],
  },
  {
    name: "explicit-override",
    config: {
      _migrations: [
        "2026-07-opencode-config-unification",
        "2026-07-codex-config-jsonc",
        "2026-08-reasoning-unification",
      ],
      categories: {
        writing: {
          model: "openai/gpt-5.6-terra",
          variant: "low",
        },
      },
    },
    parentSteps: [
      {
        type: "tool_call",
        name: "task",
        arguments: {
          category: "writing",
          prompt: "run the explicit writing override QA child",
          run_in_background: false,
        },
      },
      { type: "text", text: "explicit override QA complete" },
    ],
  },
]

function parseArgs(argv) {
  const output = { evidenceDir: undefined, selfTest: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--self-test") {
      output.selfTest = true
      continue
    }
    if (arg === "--evidence-dir") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--evidence-dir requires a path")
      output.evidenceDir = isAbsolute(value) ? value : resolve(process.cwd(), value)
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return output
}

function findOnPath(binary) {
  if (binary.includes("/")) return existsSync(binary) ? binary : null
  for (const pathEntry of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(pathEntry || ".", binary)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function resolveSenpiBinary() {
  const configured = process.env.SENPI_BIN?.trim()
  if (configured) return findOnPath(configured)
  const senpi = findOnPath("senpi")
  if (senpi !== null) return senpi
  const omo = findOnPath("omo")
  if (omo === null) return null
  const embeddedSenpi = resolve(
    dirname(realpathSync(omo)),
    "..",
    "node_modules",
    "@code-yeongyu",
    "senpi",
    "dist",
    "cli.js",
  )
  return existsSync(embeddedSenpi) ? embeddedSenpi : null
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex")
}

function digestRealOmoConfig() {
  const hash = createHash("sha256")
  for (const name of ["config.jsonc", "omo.jsonc", "omo.json"]) {
    const path = join(realOmoDir, name)
    hash.update(name)
    hash.update("\0")
    hash.update(existsSync(path) ? readFileSync(path) : Buffer.from("absent"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

function credentialDigests() {
  return Object.fromEntries(realAgentDirs.map((path) => [path, credentialDigest(path)]))
}

function seedScenario(scenario) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const script = {
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna-fast"],
    parentSteps: scenario.parentSteps,
    childSteps: [{ type: "text", text: "recommendation QA child done" }],
  }
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  let configPath
  let configDigest
  if (scenario.config !== undefined) {
    const omoDir = join(sandbox.cwd, ".omo")
    mkdirSync(omoDir, { recursive: true })
    configPath = join(omoDir, "omo.json")
    const content = `${JSON.stringify(scenario.config, null, 2)}\n`
    writeFileSync(configPath, content)
    configDigest = sha256(content)
  }
  return { sandbox, sessionDir, configPath, configDigest }
}

function runSenpi(senpiBin, fixture) {
  return spawnSync(
    senpiBin,
    [
      "-e",
      providerEntry,
      "-p",
      "--mode",
      "json",
      "--provider",
      "openai",
      "--model",
      "gpt-5.6-terra",
      "--session-dir",
      fixture.sessionDir,
      "--offline",
      "--omo-senpi-memory-disabled",
      "--omo-senpi-lsp-disabled",
      "--omo-senpi-telemetry-disabled",
      "--omo-senpi-config-watch-disabled",
      "run the OpenAI recommendation QA scenario",
    ],
    {
      cwd: fixture.sandbox.cwd,
      env: {
        ...process.env,
        HOME: fixture.sandbox.homeDir,
        USERPROFILE: fixture.sandbox.homeDir,
        OMO_CODING_AGENT_DIR: fixture.sandbox.agentDir,
        PI_CODING_AGENT_DIR: fixture.sandbox.agentDir,
        SENPI_CODING_AGENT_DIR: fixture.sandbox.agentDir,
        OMO_CODING_AGENT_SESSION_DIR: fixture.sessionDir,
        PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir,
        SENPI_CODING_AGENT_SESSION_DIR: fixture.sessionDir,
        XDG_CONFIG_HOME: fixture.sandbox.xdgConfigHome,
        OMO_SENPI_QA: "1",
      },
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
}

function readJsonLines(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}

function parseJsonOutput(text) {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter((value) => value !== undefined)
}

function containsText(value, needle) {
  if (typeof value === "string") return value.includes(needle)
  if (Array.isArray(value)) return value.some((entry) => containsText(entry, needle))
  if (typeof value !== "object" || value === null) return false
  return Object.values(value).some((entry) => containsText(entry, needle))
}

function readTaskRecords(cwd) {
  const tasksDir = join(cwd, ".omo", "senpi-task", "tasks")
  if (!existsSync(tasksDir)) return []
  return readdirSync(tasksDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(tasksDir, name), "utf8")))
    .sort((left, right) => String(left.category).localeCompare(String(right.category)))
}

function inspectAutomatic(records, outputEvents, captures) {
  const checks = {}
  const observed = {}
  for (const [category, expected] of Object.entries(automaticExpectations)) {
    const record = records.find((candidate) => candidate.category === category)
    const actualModel = record?.resolved_model === undefined
      ? undefined
      : `${record.resolved_model.provider}/${record.resolved_model.model_id}`
    const actualVariant = record?.resolved_model?.variant
    observed[category] = {
      model: actualModel ?? null,
      variant: actualVariant ?? null,
      status: record?.status ?? null,
    }
    checks[`${category}_model`] = actualModel === expected.model ? "PASS" : "FAIL"
    checks[`${category}_variant`] = actualVariant === expected.variant ? "PASS" : "FAIL"
    checks[`${category}_completed`] = record?.status === "completed" ? "PASS" : "FAIL"
  }
  for (const [agent, expected] of Object.entries(automaticAgentExpectations)) {
    const record = records.find((candidate) => candidate.agent_type === agent)
    const actualModel = record?.resolved_model === undefined
      ? undefined
      : `${record.resolved_model.provider}/${record.resolved_model.model_id}`
    const actualVariant = record?.resolved_model?.variant
    observed[agent] = {
      model: actualModel ?? null,
      variant: actualVariant ?? null,
      status: record?.status ?? null,
    }
    checks[`${agent}_model`] = actualModel === expected.model ? "PASS" : "FAIL"
    checks[`${agent}_variant`] = actualVariant === expected.variant ? "PASS" : "FAIL"
    checks[`${agent}_completed`] = record?.status === "completed" ? "PASS" : "FAIL"
  }
  checks.architect_unavailable =
    records.every((record) => record.category !== "architect") &&
    outputEvents.some((event) => containsText(event, 'No available model for category "architect"'))
      ? "PASS"
      : "FAIL"
  checks.child_models_exercised =
    captures.filter((capture) => capture.child === true).length === 6 ? "PASS" : "FAIL"
  return { checks, observed }
}

function inspectOverride(records, captures) {
  const record = records.find((candidate) => candidate.category === "writing")
  const model = record?.resolved_model === undefined
    ? undefined
    : `${record.resolved_model.provider}/${record.resolved_model.model_id}`
  return {
    checks: {
      override_model: model === "openai/gpt-5.6-terra" ? "PASS" : "FAIL",
      override_variant: record?.resolved_model?.variant === "low" ? "PASS" : "FAIL",
      override_completed: record?.status === "completed" ? "PASS" : "FAIL",
      one_child_exercised: captures.filter((capture) => capture.child === true).length === 1 ? "PASS" : "FAIL",
    },
    observed: {
      writing: {
        model: model ?? null,
        variant: record?.resolved_model?.variant ?? null,
        status: record?.status ?? null,
      },
    },
  }
}

function runScenario(senpiBin, scenario, evidenceDir) {
  const fixture = seedScenario(scenario)
  const beforeCredentials = credentialDigests()
  const beforeUserConfig = digestRealOmoConfig()
  let run
  let records = []
  let captures = []
  let configUnchanged = true
  let cleanup = "FAIL"
  try {
    run = runSenpi(senpiBin, fixture)
    records = readTaskRecords(fixture.sandbox.cwd)
    captures = readJsonLines(join(fixture.sandbox.cwd, capturesFile))
    if (fixture.configPath !== undefined && fixture.configDigest !== undefined) {
      configUnchanged = existsSync(fixture.configPath) && sha256(readFileSync(fixture.configPath)) === fixture.configDigest
    }
  } finally {
    rmSync(fixture.sandbox.root, { recursive: true, force: true })
    cleanup = existsSync(fixture.sandbox.root) ? "FAIL" : "PASS"
  }

  const afterCredentials = credentialDigests()
  const afterUserConfig = digestRealOmoConfig()
  const outputEvents = parseJsonOutput(run?.stdout ?? "")
  const inspected = scenario.name === "automatic"
    ? inspectAutomatic(records, outputEvents, captures)
    : inspectOverride(records, captures)
  const checks = {
    exit_zero: run?.status === 0 ? "PASS" : "FAIL",
    ...inspected.checks,
    sandbox_project_config_unchanged: configUnchanged ? "PASS" : "FAIL",
    real_agent_credentials_unchanged:
      JSON.stringify(beforeCredentials) === JSON.stringify(afterCredentials) ? "PASS" : "FAIL",
    real_omo_config_unchanged: beforeUserConfig === afterUserConfig ? "PASS" : "FAIL",
    sandbox_cleanup: cleanup,
  }
  const result = Object.values(checks).every((value) => value === "PASS") ? "PASS" : "FAIL"
  const verdict = {
    result,
    scenario: scenario.name,
    checks,
    observed: inspected.observed,
    childCaptures: captures.filter((capture) => capture.child === true),
  }
  if (evidenceDir !== undefined) {
    const scenarioDir = join(evidenceDir, scenario.name)
    mkdirSync(scenarioDir, { recursive: true })
    writeFileSync(join(scenarioDir, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`)
  }
  return verdict
}

function selfTest() {
  if (Object.keys(automaticExpectations).join(",") !== "artistry,writing,visual-engineering,quick") {
    throw new Error("automatic recommendation case set drifted")
  }
  if (Object.keys(automaticAgentExpectations).join(",") !== "explore,librarian") {
    throw new Error("automatic agent recommendation case set drifted")
  }
  const fixture = seedScenario(scenarios[1])
  try {
    if (fixture.configPath === undefined || fixture.configDigest === undefined) {
      throw new Error("override fixture did not create an isolated project config")
    }
    if (sha256(readFileSync(fixture.configPath)) !== fixture.configDigest) {
      throw new Error("override fixture config digest did not round-trip")
    }
  } finally {
    rmSync(fixture.sandbox.root, { recursive: true, force: true })
  }
  console.log("SELF-TEST OK")
}

function main(evidenceDir) {
  const senpiBin = resolveSenpiBinary()
  if (senpiBin === null) {
    const result = { result: "SKIP", reason: "senpi-binary-unavailable" }
    console.log(JSON.stringify(result))
    return
  }
  if (evidenceDir !== undefined) mkdirSync(evidenceDir, { recursive: true })
  const results = scenarios.map((scenario) => runScenario(senpiBin, scenario, evidenceDir))
  const summary = {
    result: results.every((scenario) => scenario.result === "PASS") ? "PASS" : "FAIL",
    senpiBinary: senpiBin,
    scenarios: results,
  }
  if (evidenceDir !== undefined) {
    writeFileSync(join(evidenceDir, "verdict.json"), `${JSON.stringify(summary, null, 2)}\n`)
  }
  console.log(JSON.stringify(summary))
  if (summary.result !== "PASS") process.exitCode = 1
}

const options = parseArgs(process.argv.slice(2))
if (options.selfTest) selfTest()
else main(options.evidenceDir)
