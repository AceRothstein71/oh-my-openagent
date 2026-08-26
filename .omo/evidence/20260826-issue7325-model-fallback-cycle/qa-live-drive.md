# QA: live drive - real opencode 1.18.23 + worktree plugin + fake LLM

## WHAT WAS TESTED

End-to-end subagent spawn model selection through the REAL stack:
real `opencode serve` (v1.18.23) + the plugin built from THIS worktree
(`dist/index.js`, rebuilt after final edits) + a local OpenAI-compatible fake
LLM (bun HTTP server on 127.0.0.1:45725 logging every requested model).

Surface driven: parent session prompt -> assistant emits a real `task` tool call
(subagent_type=oracle) -> plugin delegate-task resolves the model -> child
session created with that model -> child completion request hits the fake LLM.

## ISOLATION PROOF

- `script/agent/qa-sandbox.sh` sourced: XDG_DATA_HOME / XDG_CONFIG_HOME /
  XDG_CACHE_HOME / XDG_STATE_HOME under a fresh mktemp dir; CODEX_HOME sandboxed.
- HOME additionally redirected into the sandbox: the plugin reads `~/.omo/omo.jsonc`
  and opencode reads `~/.opencode` via HOME - both resolved inside the sandbox.
  (First drive attempt WITHOUT HOME sandboxing reproduced the exact #7325 error
  family live: `ProviderModelNotFoundError: Model not found:
  anthropic/claude-opus-4-8` - the host's real user-layer omo config leaked in.
  This accidental negative result corroborates the D1 root cause.)
- Host `~/.config/opencode`, `~/.codex`, `~/.local/share/opencode` never touched;
  host DB not opened by any driver step. All sandboxes deleted afterwards.

## WHAT WAS OBSERVED

### Boot + delegation through real plugin
`opencode run --format json "Start the QA delegation now."` with project
`.omo/omo.json` = `{agents:{oracle:{model:"qa-fake/model-from-disk"}}}`:
- exit 0, zero ERROR log lines
- event stream shows: step_start -> tool_use(task) -> tool(result) -> step_finish
  -> step_start -> text "PARENT_DONE" -> step_finish
- fake LLM request log: `parent-driver`, `parent-driver`, **`model-from-disk`**,
  `parent-driver`
=> the oracle child session was created with the model from project omo.json,
   resolved through the new fresh-config path in the REAL plugin.

### D1 freshness proof (the defect itself): mid-session config edit, same server
`opencode serve --port 4688` started once; two prompts against the SAME session:
```
ROUND 1: .omo/omo.json oracle = qa-fake/model-from-disk
         -> models requested: parent-driver, parent-driver, model-from-disk, ...
config edited mid-session to qa-fake/model-from-disk-v2 (no restart)
ROUND 2: same server
         -> models requested: ..., model-from-disk-v2, parent-driver
```
Full sequence in models-seen.log order:
```
parent-driver
parent-driver
model-from-disk        <- round 1 child
parent-driver
parent-driver
model-from-disk-v2     <- round 2 child, SAME server instance after edit
parent-driver
```
Before this fix, round 2 reused the boot snapshot (`model-from-disk`). This is
the live reproduction of the issue scenario and its fix.

Artifacts preserved under /tmp/opencode/qa7325/ (models-seen.log, drive scripts,
fake-llm.ts, run outputs); sandboxes themselves removed (paths recorded in
cleanup-receipt.md).

## WHY IT IS ENOUGH

- D1 is proven fixed on the real harness including the exact reported scenario
  (edit omo.json -> next spawn honors it without restart).
- D2/D3 are proven at the integration layer over the REAL resolution/retry/
  completion code (delegate-core resolver, background-agent retry handler and
  manager event/polling paths) via the RED->GREEN tests in red-green.md; staging
  a live multi-rung provider failure chain would require scripted provider
  errors per model id, which the fake LLM harness does not yet emulate (see
  qa-blockers.md).
