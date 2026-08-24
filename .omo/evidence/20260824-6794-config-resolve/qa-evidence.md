# QA Evidence - 20260824-6794-config-resolve

Issue: code-yeongyu/oh-my-openagent#6794
Branch: `issue/6794-senpi-opencode-config-resolve` (base dev @8833800ae)
Scope: `packages/omo-config-core` (harness-neutral config loader consumed by the
senpi adapter via `loadSenpiOmoConfig` -> `loadOmoConfig(harness: "senpi")`),
regenerated `assets/omo.schema.json`, rebuilt committed senpi extension bundles.

## WHAT WAS TESTED

1. **Failing-first regression proof** - reverted the three fix sources
   (`loader/resolution.ts`, `loader/types.ts`, `schema/config.ts`) to HEAD,
   kept the 10 new tests, ran:
   `bun test packages/omo-config-core/src/loader/resolution.test.ts packages/omo-config-core/src/loader/loader.test.ts packages/omo-config-core/src/schema/unified-config-schema.test.ts`
2. **Scoped unit suite** - `bun test packages/omo-config-core`
3. **Schema freshness** - `bun run build:omo-schema` then
   `bun test tests/omo-schema-freshness.test.ts`
4. **Repo-wide typecheck** - `bun run typecheck` (tsgo root + script + all 30
   package tsconfigs incl. omo-senpi, senpi-task, omo-opencode, omo-codex)
5. **Senpi hermetic gate** (AGENTS.md law for senpi-connected changes) -
   `bun run test:senpi` (build + stage + embed-directive check + bundle purity +
   full omo-senpi suite)
6. **OpenCode consumer** - `bun test packages/omo-opencode/src/plugin-config`
7. **Codex hermetic gate** (`[codex]` typed block schema changed) -
   `bun run test:codex`

## WHAT WAS OBSERVED

1. Failing-first: `26 pass / 7 fail` on HEAD sources. The failures reproduce
   both issue defects exactly:
   - nested `$schema` inside `[senpi]` produced a `validation` diagnostic
     ("Invalid omo config ... [senpi]") and dropped the settings (defect 2);
   - `[opencode]` agent/category models under the senpi view produced ZERO
     diagnostics while being ignored (defect 1).
   With fix sources restored: same 3 files run `33 pass / 0 fail`.
2. Scoped suite: `203 pass / 0 fail` (33 files, 518 expects).
3. Freshness: regenerated artifact matches committed bytes; `3 pass / 0 fail`.
   The regenerated diff is exactly the 12-line `$schema` addition the salvage
   carried, confirming the hand-edit equaled codegen.
4. Typecheck: green end-to-end, no errors from any package.
5. Senpi gate: `2226 pass / 7 skip / 0 fail` across 306 files; extension build,
   staging, skill sync, and embed-directive `--check` all green. The 7 skips
   are pre-existing optional-environment skips in the suite, none related to
   config loading.
6. OpenCode plugin-config chain: `4 pass / 0 fail`.
7. Codex gate: `493 pass / 0 fail`.

Isolation: no live harness was spawned by these gates; no real
`~/.senpi/agent`, `~/.codex`, or OpenCode state was read or written by the
hermetic suites (they build their own sandboxes). The worktree repair
(`git submodule update --force --init packages/shared-skills/upstreams/designpowers`)
restored a crashed-agent-broken submodule checkout to its recorded commit;
no parent gitlink changed and none of those paths are staged.

## WHY IT IS ENOUGH

- The new tests are co-located, given/when/then style, and were proven to fail
  on the pre-fix code and pass post-fix - they pin both issue defects at the
  schema layer, view-resolution layer (incl. profile overlays and the codex
  view), and end-to-end loader layer.
- The senpi adapter consumes this loader through `loadSenpiOmoConfig`; the
  full omo-senpi suite (2226 tests) exercises that path incl. config-watch
  validation fingerprinting of merged-config diagnostics, so the new
  `compatibility` kind flows through existing surfacing without breaking it.
- The codex edition shares `OmoTypedHarnessConfigSchema`; its gate is green.
- Remaining risk: live senpi binary QA was not run (see OMITTED); the change
  adds diagnostics/schema tolerance only and alters no runtime wiring, model
  resolution, or task behavior.

## WHAT WAS OMITTED

- Live Senpi driver QA (`packages/omo-senpi/scripts/qa/task-e2e.mjs` etc.):
  the `senpi` binary is not installed in this environment
  (`command -v senpi` empty). Per AGENTS.md a SKIP is not a pass and is
  recorded here as NOT RUN rather than claimed. The hermetic gates above are
  the completed portion of the senpi QA contract.
- Raw test logs are summarized; no env dumps, tokens, or credentials were
  captured or needed. No secrets appear in any artifact.
