# Isolated OpenCode live-surface QA

Result: **PASS**

OpenCode 1.18.18 was installed under a disposable prefix and run with `HOME` plus every XDG root
inside one temporary sandbox. The current worktree source plugin was supplied through
`OPENCODE_CONFIG_CONTENT` as an absolute `file://` entry.

Equivalent command, with temporary paths abstracted:

```sh
HOME="<sandbox>/home" \
XDG_DATA_HOME="<sandbox>/data" \
XDG_CONFIG_HOME="<sandbox>/config" \
XDG_CACHE_HOME="<sandbox>/cache" \
XDG_STATE_HOME="<sandbox>/state" \
OPENCODE_DISABLE_AUTOUPDATE=1 \
OPENCODE_DISABLE_MODELS_FETCH=1 \
OPENCODE_CONFIG_CONTENT='{"plugin":["file://<worktree>/packages/omo-opencode/src/index.ts"]}' \
"<temporary-prefix>/node_modules/.bin/opencode" agent list
```

Observed behavior:

- The command exited zero and loaded the current source plugin.
- `Sisyphus - ultraworker (primary)`, `explore (subagent)`, and `librarian (subagent)` were present.
- The isolated OpenCode database contained zero sessions.
- The real user OpenCode database was absent before and after the run.
- The focused OpenAI-only model catalog suite passed 7/7 cases.
- The sandbox and temporary OpenCode installation were removed.

No credentials, endpoint URLs, raw logs, environment dumps, or host-specific temporary paths are
retained in this evidence.
