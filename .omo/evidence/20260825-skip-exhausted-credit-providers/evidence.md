WHAT WAS TESTED
- Failing-first red run (before implementation existed):
  bun test packages/omo-opencode/src/shared/exhausted-providers-cache.test.ts packages/omo-opencode/src/tools/delegate-task/available-models.test.ts packages/omo-opencode/src/tools/delegate-task/model-selection.test.ts packages/omo-opencode/src/hooks/runtime-fallback/quota-provider-marker.test.ts
  Result: 0 pass / 4 fail / 4 errors — "Cannot find module './exhausted-providers-cache'" and "./quota-provider-marker" (modules not yet implemented). Red evidence captured.

- Green scoped run after fix:
  bun test <the 4 files above> + packages/omo-opencode/src/hooks/runtime-fallback/event-handler.test.ts
  Result: 53 pass / 0 fail / 95 expect() calls.

- Green wide run over both touched subsystems:
  bun test packages/omo-opencode/src/tools/delegate-task/ packages/omo-opencode/src/hooks/runtime-fallback/ packages/omo-opencode/src/shared/exhausted-providers-cache.test.ts
  Result: 788 pass / 0 fail / 1680 expect() calls across 75 files.

- Typecheck (authoritative tsgo):
  bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
  Result: exit code 0, no diagnostics.

WHAT WAS OBSERVED
- New persistent exhausted-providers cache (in-memory + JSON file via createJsonFileCacheStore, 4h TTL) marks providers on quota_exceeded runtime errors and reports them until expiry.
- getAvailableModelsForDelegateTask() now excludes models whose provider prefix is in the exhausted cache on BOTH the warm provider-models cache path and the cold client.model.list path.
- resolveModelForDelegateTask() cold-cache path now strips exhausted providers from connectedProviders before resolution, so category defaults / user fallbacks / fallback chains skip exhausted providers.
- runtime-fallback session.error handler marks the failing model's provider exhausted when classifyErrorType(error) === "quota_exceeded".
- Existing behavior preserved: with no exhausted entries, all previous tests pass unchanged (model-selection.test.ts regression guard included).

WHY IT IS ENOUGH
- Covers warm cache, cold cache, quota marking, TTL expiry, persistence across store instances, and no-exhausted-state regression guards — exactly the coverage requested in issue #3191 triage comments. Runtime-fallback retryability itself was already fixed on dev per maintainer triage; this change only adds proactive selection filtering plus marking, so unit-level verification of selection + marking is the correct scope.

WHAT WAS OMITTED
- No secrets, tokens, or env dumps appear in these runs. Live end-to-end opencode QA was not driven: the change surface is pure selection/marking logic verified at unit level under the task's hard timebox; residual risk is limited to wiring order inside handleSessionError, which is covered by event-handler.test.ts staying green.
