WHAT WAS TESTED
===============

1. Failing-first regression tests (new, co-located, given/when/then):

   - packages/senpi-task/src/senpi/service-tier.test.ts (14 tests)
     Command: bun test packages/senpi-task/src/senpi/service-tier.test.ts
     Surface: resolveParentServiceTier() tier-resolution matrix against a REAL isolated
     SettingsManager (temp agentDir, awaited flush), and createChildServiceTierExtension()
     payload-injection behavior through the public Extension handler map.
     Proves: remembered "priority" inherits; explicit remembered "auto" suppresses even under a
     priority context tier; unremembered + ctx.serviceTier priority inherits; -fast base-key
     memory normalization; openai-responses global openai.serviceTier fallback read from the
     PERSISTED settings.json; non-service-tier APIs and missing models inherit nothing;
     injection only for openai-responses/openai-codex-responses payloads, never clobbers an
     existing service_tier, untouched for non-record payloads.

   - packages/senpi-task/src/runners/in-process/child-service-tier.test.ts (5 tests)
     Command: bun test packages/senpi-task/src/runners/in-process/child-service-tier.test.ts
     Surface: buildChildSessionOptions + InProcessRunner.start with a captured createSession seam,
     PLUS a REAL senpi createAgentSession boot.
     Proves: ChildSpec.serviceTier="priority" yields exactly ONE loaded extension whose handler
     injects service_tier into a codex payload; no tier = zero extensions (pins the child
     extension-suppression invariant also asserted by senpi-api-tripwire.test.ts); the real
     createAgentSession binds the extension with zero load errors.

   - packages/senpi-task/src/manager/parent-registry-context.test.ts (+4 tests)
     Proves: the new optional resolver threads the resolved tier onto start contexts, omits the
     key when undefined or when no resolver is supplied, and rides RESUME contexts too.

   - packages/omo-senpi/src/components/task/runtime-context.test.ts (+2 tests)
     Proves: TaskRuntimeContext.captureFrom retains agentDir/model/serviceTier/isProjectTrusted
     from live senpi ExtensionContexts and defaults to undefined before any capture.

   - packages/omo-senpi/src/components/task/engine-runners.test.ts (+2 tests)
     Proves: resolveRuntimeServiceTier() over captured runtime facts reads the persisted tier
     fresh at spawn time (real SettingsManager write in an isolated temp agentDir) and returns
     undefined with no captured model.

2. Gates (repo law):

   - bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json  -> clean (exit 0)
   - bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json   -> clean (exit 0)
   - bun test packages/senpi-task                              -> 1765 pass / 0 fail / 1 skip
   - bun run test:senpi (full Senpi gate: build + stage + typecheck + suites)
     -> 2229 pass / 7 skip / 1 fail (see OBSERVED for the pre-existing failure)

WHAT WAS OBSERVED
=================

- RED first: both new test files failed before implementation (missing module; zero extensions
  loaded) and passed after, so the tests genuinely pin the new behavior.
- The full omo-senpi suite initially showed 11 failures; ALL of them reproduce on the PRISTINE
  base commit (verified via git stash): 10 are skill-sync/installer-source-refresh failures from
  missing generated artifacts in this fresh worktree, 1 is the build-extension shebang/freshness
  check that times out at 30s in this sandbox (Node minifier SIGTERM). After running the gate's
  build steps (which generate plugin/extensions + skills artifacts), 10 of those pass; only the
  30s-timeout one remains, identical on base. None touch the task engine or this change.
- Isolation proof: all test settings writes go to mkdtemp dirs under /tmp with an isolated
  agentDir; the real ~/.senpi / ~/.omo agent dirs were never read or written by the new tests.
- Repo-level git state: the pre-existing dirty submodule packages/shared-skills/upstreams/
  designpowers (all working files deleted locally) was restored to its pinned HEAD cb00757d via
  `git checkout HEAD -- .` INSIDE the submodule so `bun run test:senpi` could build. The parent
  repo records the same SHA as before; nothing submodule-related is staged by this change.

WHY IT IS ENOUGH
================

- The fix seam is exactly where the issue points: child spawn args/config construction. The unit
  tests drive the real option builder, the real resource-loader contract, and a REAL
  createAgentSession boot, asserting the extension lands in extensionsResult with zero errors -
  the same surface senpi's runner iterates to dispatch before_provider_request handlers.
- The wire semantics mirror senpi's own builtin service-tier extension byte-for-byte on the
  payload path (api gate + never clobber), and the resolution mirrors its session_start
  precedence (remembered priority/auto, then catalog/pin tier; openai-responses global setting).
  Reading the remembered tier FRESH at spawn makes in-session /fast toggles correct without any
  event tracking.
- Process-mode (rpc) children already inherit natively (they boot a full senpi process whose own
  builtin extension reads the persisted settings); this change gives in-process children the same
  outcome, so no cross-mode behavior gap remains.
- Remaining regression risk: senpi could change its service-tier persistence keys or precedence.
  The pinned-API tripwire suite plus these co-located tests make such drift loud and local.

WHAT WAS OMITTED
================

- No live senpi-binary QA driver exists for asserting request service_tier in this environment
  (no SENPI_BIN available; the task-e2e/team-e2e drivers report SKIP without it). The hermetic
  unit gate plus a real createAgentSession boot stand in; recorded here per the evidence rules
  rather than claiming live-harness proof.
- Raw test output logs are summarized above instead of pasted (they contain absolute tmp paths
  and machine-specific timings only; no secrets were present in any captured output).
- An explicit task-tool override option (fast / service_tier) from the issue's alternative
  contract was deliberately not added; implicit inheritance only, per the minimal-contract plan.
