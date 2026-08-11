import {
  OMO_ACTIVE_PROFILE_KEY,
  readOmoProfileState,
  updateOmoConfig,
  type OmoConfigEnv,
  type OmoProfileState,
  type ResolvedOmoProfile,
} from "@oh-my-opencode/omo-config-core"
import type { ProfileCommandOptions } from "./types"

type ProfileContext = {
  readonly cwd: string
  readonly environment: OmoConfigEnv
  readonly print: (line: string) => void
  readonly printError: (line: string) => void
}

function resolveContext(options: ProfileCommandOptions): ProfileContext {
  return {
    cwd: options.cwd ?? process.cwd(),
    environment: options.environment ?? process.env,
    print: options.output ?? console.log,
    printError: options.errorOutput ?? console.error,
  }
}

function readState(context: ProfileContext): OmoProfileState {
  const state = readOmoProfileState({ cwd: context.cwd, env: context.environment })
  for (const diagnostic of state.diagnostics) {
    // The "activated profile does not exist" diagnostic points at profiles.<name>;
    // these commands report that state themselves, in their own wording.
    if (diagnostic.kind === "profile" && diagnostic.path.startsWith("profiles.")) continue
    context.printError(diagnostic.message)
  }
  return state
}

function originLabel(active: ResolvedOmoProfile): string {
  return active.origin === "persisted" ? "persisted in your omo config" : `from ${active.origin}`
}

function definedProfilesSentence(state: OmoProfileState): string {
  return state.profiles.length === 0
    ? "No profiles are defined in your omo config."
    : `Defined profiles: ${state.profiles.join(", ")}.`
}

function persistActiveProfile(value: string | undefined, context: ProfileContext): string | undefined {
  try {
    return updateOmoConfig({
      edits: [{ path: [OMO_ACTIVE_PROFILE_KEY], value }],
      env: context.environment,
      scope: "user",
    }).path
  } catch (error) {
    context.printError(error instanceof Error ? error.message : String(error))
    return undefined
  }
}

export function runProfileList(options: ProfileCommandOptions = {}): number {
  const context = resolveContext(options)
  const state = readState(context)
  if (state.profiles.length === 0) {
    context.print(`No profiles defined. Add a "profiles" block to your omo config (~/.omo/omo.jsonc).`)
    return 0
  }

  context.print("Profiles:")
  for (const name of state.profiles) {
    context.print(`${state.active?.name === name ? "*" : " "} ${name}`)
  }
  if (state.active !== undefined) {
    context.print(`Active: ${state.active.name} (${originLabel(state.active)})`)
  }
  return 0
}

export function runProfileCurrent(options: ProfileCommandOptions = {}): number {
  const context = resolveContext(options)
  const state = readState(context)
  const active = state.active
  if (active === undefined) {
    context.print("No active profile (using the base config).")
    return 0
  }

  context.print(`${active.name} (${originLabel(active)})`)
  if (!state.profiles.includes(active.name)) {
    context.print(`Warning: profile "${active.name}" is not defined in your omo config, so the base config is used.`)
  }
  return 0
}

export function runProfileUse(name: string, options: ProfileCommandOptions = {}): number {
  const context = resolveContext(options)
  const state = readState(context)
  if (!state.profiles.includes(name)) {
    context.printError(`Unknown profile "${name}". ${definedProfilesSentence(state)}`)
    return 1
  }

  const path = persistActiveProfile(name, context)
  if (path === undefined) return 1

  const nextState = readState(context)
  if (nextState.active?.name === name && nextState.active.origin === "persisted") {
    context.print(`Activated profile "${name}" (persisted in ${path}).`)
    return 0
  }

  context.print(`Persisted profile "${name}" in ${path}.`)
  if (nextState.active === undefined) {
    context.print("No active profile (using the base config).")
  } else {
    context.print(`Active profile remains "${nextState.active.name}" (${originLabel(nextState.active)}).`)
  }
  return 0
}

export function runProfileClear(options: ProfileCommandOptions = {}): number {
  const context = resolveContext(options)
  const state = readState(context)
  if (state.persisted === undefined) {
    if (state.active === undefined) context.print("No persisted profile to clear; already using the base config.")
    else context.print(`No persisted profile to clear; active profile is "${state.active.name}" (${originLabel(state.active)}).`)
    return 0
  }

  const path = persistActiveProfile(undefined, context)
  if (path === undefined) return 1

  const nextState = readState(context)
  context.print(`Cleared the persisted profile "${state.persisted}" in ${path}.`)
  if (nextState.active === undefined) context.print("No active profile (using the base config).")
  else context.print(`Active profile remains "${nextState.active.name}" (${originLabel(nextState.active)}).`)
  return 0
}
