# Plan: Fix #6794 - senpi edition silently ignores [opencode] omo config

Branch: `issue/6794-senpi-opencode-config-resolve` (worktree `/home/viprix/projects/oom-wt-6794`, base dev @8833800ae)

## Root cause (file:line, HEAD 8833800ae)

1. **Silent ignore of `[opencode]` settings under the senpi view**
   `packages/omo-config-core/src/loader/resolution.ts:55-58` (`harnessLayer()`):
   the view resolver layers only `config["[senpi]"]` for `harness: "senpi"`.
   Shared keys (`agents`, `categories`, `models`, ...) left under `[opencode]`
   after migrating from the OpenCode edition are dropped with no diagnostic,
   so delegated tasks fall back to built-in model chains (issue: DeepSeek
   fallback despite user config).
2. **Strict typed harness block rejects nested `$schema`**
   `packages/omo-config-core/src/schema/config.ts:19-29`
   (`OmoTypedHarnessConfigSchema ... .strict()`): copying the whole
   `[opencode]` object into `[senpi]` carries a nested `$schema` key which the
   strict schema rejects, invalidating the effective config with an
   insufficiently visible error.

## Chosen fix (issue "Expected Behavior" option B; maintainer comment leaves
auto-migration architecture unconfirmed, so no cross-edition projection)

- Emit a `compatibility` diagnostic from `resolveOmoConfigView()` when a
  non-opencode view sees shared setting keys inside `[opencode]` blocks
  (root + active profile), naming the ignored keys and the actionable move.
- Tolerate + strip `$schema` inside typed harness blocks
  (`[senpi]` / `[codex]`) at schema level and in `harnessLayer()`.
- Regenerate `assets/omo.schema.json` via `bun run build:omo-schema`.

## Files changed (salvaged from crashed agent, re-verified here)

| File | Change |
|------|--------|
| `packages/omo-config-core/src/loader/resolution.ts` | strip `$schema` in `harnessLayer`; add `opencodeCompatibilityDiagnostics()` |
| `packages/omo-config-core/src/loader/types.ts` | add `"compatibility"` diagnostic kind |
| `packages/omo-config-core/src/schema/config.ts` | optional `$schema` on typed harness block; export `TYPED_HARNESS_SETTING_KEYS` |
| `packages/omo-config-core/src/loader/loader.test.ts` | 2 regression tests (end-to-end loader view) |
| `packages/omo-config-core/src/loader/resolution.test.ts` | 6 regression tests (view resolution incl. profile + codex) |
| `packages/omo-config-core/src/schema/unified-config-schema.test.ts` | 2 schema tests ($schema tolerated, unknown key still rejected) |
| `assets/omo.schema.json` | regenerated artifact |

## Verification plan

1. Failing-first proof: revert fix sources to HEAD, run new tests -> expect
   failures; restore.
2. `bun test packages/omo-config-core` scoped suite green.
3. Schema freshness test green after regeneration.
4. Typecheck: `bun run typecheck` (or scoped tsgo per package).
5. Senpi hermetic gate (AGENTS.md law, change is senpi-connected via
   omo-config-core): `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` +
   `bun run test:senpi`. Live senpi drivers only if `senpi` binary present;
   SKIP will be recorded as such, not claimed as pass.
6. Evidence recorded in this directory; commit only intended files
   (never `packages/shared-skills/upstreams/*`, never `.build-extension-test-*`).

## Constraints honored

- No `as any` / `@ts-ignore` / `@ts-expect-error`; no weakened/deleted tests;
  no unrelated refactors; no commits to dev; no force-push.
