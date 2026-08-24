import { SettingsManager, createSyntheticSourceInfo, type BeforeProviderRequestEvent, type Extension } from "@code-yeongyu/senpi"

/** The tier values senpi's service-tier surface persists and puts on the wire. */
export type ChildServiceTier = "auto" | "flex" | "priority"

/** The only wire APIs senpi's own service-tier extension ever injects `service_tier` into. */
const SERVICE_TIER_WIRE_APIS = new Set(["openai-responses", "openai-codex-responses"])

const CHILD_SERVICE_TIER_EXTENSION_PATH = "<inline:omo-child-service-tier>"
const FAST_MODEL_SUFFIX = "-fast"

/**
 * A hand-built (public-type) Extension injected into in-process task children so an inherited
 * parent service tier reaches the wire. Children deliberately load NO discovered extensions
 * (child extension suppression), and senpi core never adds `service_tier` to payloads itself -
 * the builtin service-tier extension is the only injection point in a normal session. This
 * extension restores exactly that one behavior for children, nothing else.
 */
export function createChildServiceTierExtension(input: {
  readonly registrationCwd: string
  readonly serviceTier: ChildServiceTier
}): Extension {
  const handler = async (...args: unknown[]): Promise<unknown> => {
    const event = args[0] as BeforeProviderRequestEvent | undefined
    if (event === undefined) return undefined
    const ctx = args[1] as { readonly model?: unknown } | undefined
    const api = requestModelApi(ctx?.model) ?? requestModelApi(event.model)
    if (api === undefined || !SERVICE_TIER_WIRE_APIS.has(api)) return undefined
    if (!isRecord(event.payload) || event.payload.service_tier !== undefined) return undefined
    return { ...event.payload, service_tier: input.serviceTier }
  }

  return {
    path: CHILD_SERVICE_TIER_EXTENSION_PATH,
    resolvedPath: CHILD_SERVICE_TIER_EXTENSION_PATH,
    sourceInfo: createSyntheticSourceInfo(CHILD_SERVICE_TIER_EXTENSION_PATH, {
      source: "omo-senpi-task child service-tier inheritance",
      scope: "temporary",
    }),
    handlers: new Map([[ "before_provider_request", [handler] ]]),
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
    mcpServers: new Map(),
    registrationCwd: input.registrationCwd,
  }
}

/**
 * Context facts the PARENT session exposes at spawn time. senpi's ExtensionContext satisfies it
 * structurally; tests pass plain objects.
 */
export type ParentServiceTierContext = {
  readonly cwd: string
  readonly agentDir?: string
  /** Active parent model; narrowed structurally so no concrete senpi Model type is required. */
  readonly model?: unknown
  /** Parent's resolved tier from scoped/favorite pins or the model catalog (NOT the /fast flag). */
  readonly serviceTier?: ChildServiceTier
  readonly isProjectTrusted?: () => boolean
}

/**
 * Resolve the service tier a delegated child should inherit from its parent session.
 *
 * Mirrors the precedence of senpi's builtin service-tier extension for a fresh session:
 * - codex-responses models: an explicitly remembered per-model tier wins ("priority" inherits,
 *   an explicit `/fast off` "auto" suppresses); with no memory, a priority resolved from the
 *   parent's model selection (a `:priority` pin or catalog tier) inherits.
 * - openai-responses models: the context tier (catalog `-fast` variants resolve here) with the
 *   global `openai.serviceTier` setting as fallback.
 * - every other API: nothing to inherit - the parent never injects a tier there either.
 *
 * The remembered tier is read FRESH at spawn time, so an in-session `/fast` toggle is honored
 * without any event tracking.
 */
export function resolveParentServiceTier(ctx: ParentServiceTierContext): ChildServiceTier | undefined {
  const model = narrowModel(ctx.model)
  if (model === undefined || !SERVICE_TIER_WIRE_APIS.has(model.api)) return undefined

  const settings = SettingsManager.create(ctx.cwd, ctx.agentDir, {
    projectTrusted: ctx.isProjectTrusted?.() ?? true,
  })

  if (model.api === "openai-codex-responses") {
    const remembered =
      settings.getModelServiceTier(model.provider, model.id) ??
      rememberedBaseModelTier(settings, model.provider, model.id)
    if (remembered === "priority") return "priority"
    if (remembered === "auto") return undefined
    return ctx.serviceTier === "priority" ? "priority" : undefined
  }

  return ctx.serviceTier ?? settings.getOpenAIServiceTier() ?? undefined
}

type NarrowedModel = { readonly api: string; readonly provider: string; readonly id: string }

function narrowModel(value: unknown): NarrowedModel | undefined {
  if (!isRecord(value)) return undefined
  const api = value.api
  const provider = value.provider
  const id = value.id
  if (typeof api !== "string" || typeof provider !== "string" || typeof id !== "string") return undefined
  return { api, provider, id }
}

function requestModelApi(value: unknown): string | undefined {
  const model = narrowModel(value)
  return model?.api
}

/**
 * `/fast` remembers the tier under the BASE-model key (`resolveServiceTierMemoryModel`), so a
 * hand-made `-fast` catalog variant reads its base model's memory when it has none of its own.
 */
function rememberedBaseModelTier(
  settings: SettingsManager,
  provider: string,
  modelId: string,
): ReturnType<SettingsManager["getModelServiceTier"]> {
  if (!modelId.endsWith(FAST_MODEL_SUFFIX)) return undefined
  return settings.getModelServiceTier(provider, modelId.slice(0, -FAST_MODEL_SUFFIX.length))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
