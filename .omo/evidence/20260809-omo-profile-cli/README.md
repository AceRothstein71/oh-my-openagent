# QA evidence: `omo profile` CLI + persisted `active_profile` (issue #6657)

Change under test: a new `profile` command group on the omo CLI
(`list` / `use <name>` / `current` / `clear`) plus a new optional top-level
`active_profile` key in the omo config that persists the selection. The key is
resolved as the LOWEST-priority activation source, so the shipped precedence
`OMO_PROFILE > OCX_PROFILE > OPENCODE_CONFIG_DIR tail profiles/<name> > none`
keeps working and only gains one step before `none`.

Every QA run below used a throwaway `HOME` plus isolated
`XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME`
(and an isolated `CODEX_HOME` for the Codex check), and each script removes its
sandbox at the end.

## 1. Failing-first tests

- **What was tested:** the new behavioral tests were run before any production
  change existed: `packages/omo-config-core/src/loader/active-profile.test.ts`,
  `packages/omo-opencode/src/cli/profile/{profile,index}.test.ts`, and the
  `cli-program` registration assertion.
- **What was observed:** 4 failing / 3 module-resolution errors, each naming the
  missing surface (`Export named 'readOmoProfileState' not found`,
  `Cannot find module './profile'`, `program.addCommand(createProfileCommand())`
  absent). Artifact: [`red-tests.txt`](./red-tests.txt).
- **Why it is enough:** the failures are caused by the absent CLI/persistence
  contract, not by an assertion typo, so the later green run proves the new code
  is what satisfies them. Artifact: [`green-tests.txt`](./green-tests.txt)
  (155 pass across the scoped files), full suite in
  [`bun-test-full.txt`](./bun-test-full.txt) (13439 pass, 0 fail) and
  [`typecheck.txt`](./typecheck.txt).

## 2. Real CLI manual QA (built CLI, isolated HOME)

- **What was tested:** [`cli-manual-qa.sh`](./cli-manual-qa.sh) drives the built
  CLI (`dist/cli-node/index.js`) through help, list, current, unknown-name use,
  happy-path use, env-override reporting, clear, and clear-when-nothing-persisted.
- **What was observed:** [`cli-manual-qa.txt`](./cli-manual-qa.txt).
  Highlights: `profile use nope` exits 1 with
  `Unknown profile "nope". Defined profiles: gpt, kimi.` and leaves the file
  byte-identical; `profile use gpt` appends `"active_profile": "gpt"` while the
  JSONC comment survives and a timestamped `.bak` is written;
  `OMO_PROFILE=kimi profile current` prints `kimi (from OMO_PROFILE)`;
  `OPENCODE_CONFIG_DIR=.../profiles/kimi profile current` prints
  `kimi (from OPENCODE_CONFIG_DIR)`; `profile clear` removes the key and the
  second `clear` reports nothing to clear.
- **Why it is enough:** it exercises the exact user-visible contract from the
  issue on the shipped artifact, including the failure path and the two
  environment sources that must outrank persistence.

## 3. OpenCode harness QA (opencode-qa Case A, real binary + real plugin)

- **What was tested:** [`opencode-qa.sh`](./opencode-qa.sh) loads the built
  plugin (`dist/index.js`) into an isolated opencode config and reads the
  resolved configuration with `opencode debug config` (opencode 1.18.15) after
  each CLI action. The fixture retargets exactly one agent model, so the winning
  layer is directly observable.
- **What was observed:** [`opencode-qa.txt`](./opencode-qa.txt).
  1. no selection -> `anthropic/base-oracle-model`
  2. after `omo profile use gpt` -> `openai/gpt-profile-model` (persisted
     selection reaches OpenCode with no env var set)
  3. `OMO_PROFILE=kimi` -> `kimi/kimi-profile-model` (env still wins at runtime)
  4. after `omo profile clear` -> `anthropic/base-oracle-model`
  Each step records the `opencode debug config` exit code and stdout size so an
  empty read cannot be mistaken for a pass.
- **Isolation proof:** real `~/.local/share/opencode/opencode.db` session count
  7409 before and 7409 after; host `~/.omo/omo.jsonc` sha256 identical before
  and after (`77b76d2c...`).
- **Why it is enough:** this is the issue's Scenario 3 (activation must change
  what OpenCode actually runs with), proven on the real harness rather than
  through unit mocks.

## 4. Codex side

- **What was tested:** no file under `packages/omo-codex/` changed, but the
  Codex plugin reads omo config through the same core, so
  [`codex-config-check.sh`](./codex-config-check.sh) drives the real Codex
  loader (`getCodexOmoConfig`) in an isolated `HOME` + `CODEX_HOME`.
- **What was observed:** [`codex-config-check.txt`](./codex-config-check.txt) -
  base `anthropic/base-model`, after `omo profile use gpt` the `[codex]` profile
  block folds in (`openai/gpt-profile-model`), and `OMO_PROFILE=nonexistent`
  degrades to the base config. Real `~/.codex/config.toml` sha256 unchanged; the
  sandbox `CODEX_HOME` stayed empty.
- **Gate:** `bun run test:codex` green (516 node tests + the bun subset),
  artifact [`test-codex.txt`](./test-codex.txt).

## 5. What was omitted and why

- No TUI smoke and no SSE hook probe: this change adds no lifecycle hook and no
  TUI surface. The observable effect is config resolution, which
  `opencode debug config` reads directly.
- No live model call: the fixtures use fake provider/model ids on purpose, so
  QA needs no credentials and no network. That is sufficient because the claim
  under test is which config layer wins, not whether a provider answers.
- No raw secret material is included: the captured artifacts contain only
  sandbox paths, fake model ids, and hashes. No tokens, auth headers, or env
  dumps were recorded.
- The full `opencode debug config` JSON dumps (~300 KB each) stayed in the
  sandbox and were deleted with it; only the decisive model lines plus each
  run's exit code and byte count are kept here.
