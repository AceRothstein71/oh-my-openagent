#!/usr/bin/env bash
set -euo pipefail

repo="$(git rev-parse --show-toplevel)"
evidence_dir="$(cd "$(dirname "$0")" && pwd)"
skill_dir="$repo/.agents/skills/opencode-qa"
real_db="$(opencode db path)"
before="$(sqlite3 "$real_db" 'SELECT count(*) FROM session')"

(
  source "$skill_dir/scripts/lib/common.sh"
  oqa_mk_isolated_xdg
  port="$(oqa_free_port)"
  mkdir -p "$XDG_CONFIG_HOME/opencode" "$OQA_PROJ/.omo" "$HOME/.omo"
  cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<JSON
{
  "provider": {
    "openai": {
      "options": { "baseURL": "http://127.0.0.1:$port/v1", "apiKey": "qa-only" },
      "models": { "mock-1": { "name": "Mock One" } }
    }
  }
}
JSON
  cat > "$HOME/.omo/omo.jsonc" <<'JSON'
{
  "active_profile": "focused",
  "profiles": {
    "focused": { "[opencode]": { "tui": { "sidebar": { "enabled": false } } } },
    "gpt": { "[opencode]": { "tui": { "sidebar": { "enabled": false } } } }
  }
}
JSON
  printf '{ "active_profile": "gpt" }\n' > "$OQA_PROJ/.omo/omo.jsonc"
  FAKE_OPENAI_PORT="$port" FAKE_LLM_LOG="$evidence_dir/fake-provider.log" \
    node "$skill_dir/scripts/lib/fake-openai-server.mjs" > "$evidence_dir/fake-provider.stdout.log" 2> "$evidence_dir/fake-provider.stderr.log" &
  fake_pid=$!
  trap 'kill "$fake_pid" 2>/dev/null || true' EXIT
  oqa_wait_http "http://127.0.0.1:$port/health" "" 10

  cd "$OQA_PROJ"
  bun "$repo/packages/omo-opencode/src/cli/index.ts" profile current \
    > "$evidence_dir/profile-project-override.stdout.log" 2> "$evidence_dir/profile-project-override.stderr.log"
  bun "$repo/packages/omo-opencode/src/cli/index.ts" profile use gpt \
    > "$evidence_dir/profile-use.stdout.log" 2> "$evidence_dir/profile-use.stderr.log"
  OMO_PROFILE=focused bun "$repo/packages/omo-opencode/src/cli/index.ts" profile clear \
    > "$evidence_dir/profile-clear.stdout.log" 2> "$evidence_dir/profile-clear.stderr.log"
  OMO_PROFILE=focused opencode run --model openai/mock-1 --format json 'Reply with the fake-provider completion.' \
    > "$evidence_dir/opencode-run.jsonl" 2> "$evidence_dir/opencode-run.stderr.log"
  jq -e 'select(.type == "text" and (.part.text | contains("fake response")))' "$evidence_dir/opencode-run.jsonl" \
    > "$evidence_dir/opencode-run-text-event.json"
)

after="$(sqlite3 "$real_db" 'SELECT count(*) FROM session')"
printf 'real_db=%s\nsessions_before=%s\nsessions_after=%s\nunchanged=%s\n' \
  "$real_db" "$before" "$after" "$([ "$before" = "$after" ] && echo true || echo false)" \
  > "$evidence_dir/session-isolation-proof.txt"
test "$before" = "$after"
