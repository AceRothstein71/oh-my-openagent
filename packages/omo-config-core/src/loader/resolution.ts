import {
  HARNESS_IDS,
  OMO_CONFIG_HARNESS_IDS,
  TYPED_HARNESS_SETTING_KEYS,
  type HarnessId,
  type OmoHarnessId,
} from "../schema"
import { mergeOmoConfigRecords } from "./merge"
import type { OmoConfigDiagnostic, OmoConfigEnv } from "./types"

export type ResolveOmoProfileNameOptions = {
  readonly env?: OmoConfigEnv
  readonly profile?: string
}

export type ResolveOmoConfigViewOptions = {
  readonly config: Readonly<Record<string, unknown>>
  readonly harness?: OmoHarnessId | HarnessId
  readonly profile?: string
}

export type ResolveOmoConfigViewResult = {
  readonly config: Record<string, unknown>
  readonly diagnostics: readonly OmoConfigDiagnostic[]
  readonly profile?: string
}

const HARNESS_KEYS = [...new Set([...HARNESS_IDS, ...OMO_CONFIG_HARNESS_IDS])].map((harness) => `[${harness}]`)

const MERGED_OMO_CONFIG_DIAGNOSTIC_PATH = "(merged omo config)"
const OPENCODE_HARNESS_KEY = "[opencode]"

function profileName(value: string | undefined): string | undefined {
  return value === "" ? undefined : value
}

function profileNameFromOpenCodeConfigDir(path: string | undefined): string | undefined {
  const match = path?.match(/(?:^|[\\/])profiles[\\/]([^\\/]+)[\\/]*$/)
  return profileName(match?.[1])
}

export function resolveOmoProfileName(options: ResolveOmoProfileNameOptions = {}): string | undefined {
  const env = options.env ?? process.env
  return profileName(options.profile)
    ?? profileName(env["OMO_PROFILE"])
    ?? profileName(env["OCX_PROFILE"])
    ?? profileNameFromOpenCodeConfigDir(env["OPENCODE_CONFIG_DIR"])
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function withoutControlKeys(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (key === "profiles" || HARNESS_KEYS.includes(key)) continue
    result[key] = value
  }
  return result
}

function harnessLayer(config: Readonly<Record<string, unknown>>, harness?: OmoHarnessId | HarnessId): Record<string, unknown> {
  if (harness === undefined) return {}
  const layer = toRecord(config[`[${harness}]`])
  if (layer === undefined) return {}
  const settings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(layer)) {
    if (key === "$schema") continue
    settings[key] = value
  }
  return settings
}

function opencodeCompatibilityDiagnostics(
  config: Readonly<Record<string, unknown>>,
  profile: Record<string, unknown> | undefined,
  harness?: OmoHarnessId | HarnessId,
): OmoConfigDiagnostic[] {
  if (harness === undefined || harness === "opencode") return []
  const blocks = [toRecord(config[OPENCODE_HARNESS_KEY]), profile === undefined ? undefined : toRecord(profile[OPENCODE_HARNESS_KEY])]
  const ignoredKeys = TYPED_HARNESS_SETTING_KEYS.filter((key) => blocks.some((block) => block !== undefined && Object.hasOwn(block, key)))
  if (ignoredKeys.length === 0) return []
  return [{
    kind: "compatibility",
    message: `Ignored ${OPENCODE_HARNESS_KEY} settings under the ${harness} view: ${ignoredKeys.join(", ")}. `
      + `Move shared settings to the top level or the [${harness}] block; ${OPENCODE_HARNESS_KEY} applies only to the OpenCode edition.`,
    path: MERGED_OMO_CONFIG_DIAGNOSTIC_PATH,
  }]
}

export function resolveOmoConfigView(options: ResolveOmoConfigViewOptions): ResolveOmoConfigViewResult {
  const profiles = toRecord(options.config["profiles"])
  const profile = options.profile === undefined ? undefined : toRecord(profiles?.[options.profile])
  const diagnostics: OmoConfigDiagnostic[] = profile === undefined && options.profile !== undefined
    ? [{
      kind: "profile",
      message: `Activated omo profile \"${options.profile}\" does not exist; using the base configuration`,
      path: `profiles.${options.profile}`,
    }]
    : []
  const layers = [
    withoutControlKeys(options.config),
    harnessLayer(options.config, options.harness),
    profile === undefined ? {} : withoutControlKeys(profile),
    profile === undefined ? {} : harnessLayer(profile, options.harness),
  ]

  let config: Record<string, unknown> = {}
  for (const layer of layers) config = mergeOmoConfigRecords(config, layer)

  const resolvedProfile = options.profile !== undefined && profile !== undefined ? options.profile : undefined
  return {
    config: withoutControlKeys(config),
    diagnostics: [
      ...opencodeCompatibilityDiagnostics(options.config, profile, options.harness),
      ...diagnostics,
    ],
    ...(resolvedProfile === undefined ? {} : { profile: resolvedProfile }),
  }
}
