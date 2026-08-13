# Isolated OpenCode live-surface QA

Result: **PASS**

OpenCode 1.18.18 was installed under a disposable prefix and run with `HOME` plus every XDG root
inside one temporary sandbox. The current worktree source plugin was supplied through
`OPENCODE_CONFIG_CONTENT` as an absolute `file://` entry.

Equivalent command, with the two temporary paths made explicit:

```sh
OPENCODE_BIN="<temporary-prefix>/node_modules/.bin/opencode"
QA_ROOT="<temporary-sandbox>"
WORKTREE="<PR-worktree>"
HOME="$QA_ROOT/home" \
XDG_DATA_HOME="$QA_ROOT/data" \
XDG_CONFIG_HOME="$QA_ROOT/config" \
XDG_CACHE_HOME="$QA_ROOT/cache" \
XDG_STATE_HOME="$QA_ROOT/state" \
OPENCODE_DISABLE_AUTOUPDATE=1 \
OPENCODE_DISABLE_MODELS_FETCH=1 \
OPENCODE_CONFIG_CONTENT="{\"plugin\":[\"file://$WORKTREE/packages/omo-opencode/src/index.ts\"]}" \
"$OPENCODE_BIN" agent list
```

Observed behavior:

- Exit code was zero.
- `Sisyphus - ultraworker (primary)`, `explore (subagent)`, and `librarian (subagent)` were present.
- The isolated OpenCode database contained zero sessions after the command.
- The real user OpenCode database was absent before and after, so no host session or config state
  was created.
- The focused OpenCode catalog suite passed 7/7 cases against the same current source tree.
- The temporary sandbox and temporary OpenCode installation were removed after capture.

Why this is enough: the real OpenCode loader imported the moved recommendation policy through the
current plugin entry and completed config/agent registration, while the focused catalog suite proves
the OpenAI-only generated values remain unchanged.

No credentials, endpoint URLs, raw logs, or host-specific paths are retained in this evidence.
