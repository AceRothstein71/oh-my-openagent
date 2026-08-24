# Plan: Issue #6795 - delegated tasks must inherit the parent codex fast-mode service tier

## Root cause (evidence-backed)

- Parent `/fast` (openai-codex) persists `service_tier: "priority"` per model in settings
  (`SettingsManager.setModelServiceTier`) and sets a session flag; senpi's builtin
  `service-tier` extension injects `service_tier` into outgoing payloads for
  `openai-responses` / `openai-codex-responses` models only.
- In-process task children are built by `packages/senpi-task/src/runners/in-process/child-options.ts`
  (`buildChildSessionOptions`) with the resource loader from
  `packages/senpi-task/src/runners/in-process/child-loader.ts`, which returns an EMPTY
  extension set on purpose (child extension suppression). Therefore:
  1. nothing in the child ever injects `service_tier` onto the wire, and
  2. no parent tier fact is propagated: `ChildSpec`
     (`packages/senpi-task/src/runners/in-process.ts`) carries model/thinkingLevel identity only.
- Process-mode (rpc) children spawn a full senpi process whose own builtin service-tier
  extension reads the persisted settings, so they already inherit; in-process children do not.

## Contract chosen

Implicit inheritance of the parent's effective wire tier (issue's primary expectation):
a spawned in-process child request carries the same `service_tier` the parent would put on
the wire for a codex/openai-responses model, unless the child's active model is not on a
service-tier API. No new public task-tool option (nothing can override today; explicit
option is the issue's alternative contract and is deliberately not added).

## Changes

1. `packages/senpi-task/src/senpi/service-tier.ts` (new)
   - `ChildServiceTier` = "auto" | "flex" | "priority".
   - `createChildServiceTierExtension({registrationCwd, serviceTier})`: hand-built public-type
     `Extension` whose single `before_provider_request` handler mirrors senpi's
     `addServiceTierToPayload`: gate on active model api in {openai-responses,
     openai-codex-responses}, never clobber an existing `payload.service_tier`.
   - `resolveParentServiceTier(ctx)`: resolves the parent's effective tier from the SAME state
     the engine's extension uses - fresh read of the remembered per-model tier via
     `SettingsManager.getModelServiceTier` (project-trust parity), `-fast` base-key fallback,
     then `ctx.serviceTier === "priority"` when unremembered; openai-responses falls back to
     `getOpenAIServiceTier()`. Explicit remembered "auto" suppresses inheritance.
2. `minimal-resource-loader.ts`: options accept optional `extensions` (default [] keeps the
   pinned zero-extension invariant).
3. `runners/in-process/child-loader.ts`: `createChildResourceLoader({cwd, serviceTier?})`
   includes exactly the one child service-tier extension when a tier is provided.
4. `runners/in-process/child-options.ts`: thread `spec.serviceTier` into the loader.
5. `runners/in-process.ts`: `ChildSpec.serviceTier?`.
6. `manager/runner.ts`: `InProcessSessionContext.serviceTier?` + `toChildSpec` threading.
7. `manager/parent-registry-context.ts`: optional second resolver
   `resolveServiceTier`; applied on both start and resume context paths.
8. `packages/omo-senpi/src/components/task/runtime-context.ts`: capture
   `agentDir` / `model` / `serviceTier` / `isProjectTrusted` from live contexts.
9. `packages/omo-senpi/src/components/task/engine-runners.ts`: pass the tier resolver
   (calls `resolveParentServiceTier` over captured facts) into
   `createParentRegistrySessionContext`.

## Verification

- Failing-first unit tests (given/when/then) co-located:
  - `src/senpi/service-tier.test.ts`: resolution matrix + injection behavior.
  - `src/runners/in-process/child-service-tier.test.ts`: spec -> loader wiring, handler
    payload mutation, zero-extension invariant without a tier.
  - `parent-registry-context.test.ts` / `engine-runners.test.ts` / `runtime-context.test.ts`
    extensions for threading/capture.
- Gates: `bun test packages/senpi-task packages/omo-senpi` (scoped), 
  `tsgo --noEmit` package typechecks.
- Live-harness note: no `senpi` binary QA driver exists for tier assertion in this
  environment; unit scope covers the seam the engine itself exposes. Recorded as OMITTED.

## Risk

- Resolution drift if senpi changes its service-tier persistence semantics; mitigated by
  reading the same SettingsManager keys the engine writes and mirroring its precedence.
- Children of non-codex models unaffected (api gate). Process-mode children unchanged.
