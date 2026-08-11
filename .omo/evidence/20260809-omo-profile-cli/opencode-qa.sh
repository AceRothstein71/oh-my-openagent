#!/usr/bin/env bash
# opencode-qa (Case A: CLI surface) for the persisted omo profile selection.
#
# Proves the round trip that issue #6657 asks for: `omo profile use <name>`
# persists a selection, and a plain opencode run then resolves the profile's
# [opencode] overrides through the real plugin - no environment variable set.
# Everything runs in an isolated HOME + XDG sandbox; the real opencode DB and
# the real ~/.omo are never written.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLI="node ${REPO_ROOT}/dist/cli-node/index.js"
PLUGIN="file://${REPO_ROOT}/dist/index.js"
REAL_DB="${HOME}/.local/share/opencode/opencode.db"

sessions_before="$(sqlite3 "${REAL_DB}" 'select count(*) from session' 2>/dev/null || echo "n/a")"
host_omo_before="$(shasum -a 256 "${HOME}/.omo/omo.jsonc" 2>/dev/null || echo "n/a")"

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/omo-profile-opencode-qa.XXXXXX")"
export HOME="${SANDBOX}/home"
export XDG_CONFIG_HOME="${SANDBOX}/config"
export XDG_DATA_HOME="${SANDBOX}/data"
export XDG_STATE_HOME="${SANDBOX}/state"
export XDG_CACHE_HOME="${SANDBOX}/cache"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
unset OMO_PROFILE OCX_PROFILE OPENCODE_CONFIG_DIR
mkdir -p "${HOME}/.omo" "${XDG_CONFIG_HOME}/opencode" "${XDG_DATA_HOME}" "${XDG_STATE_HOME}" "${XDG_CACHE_HOME}" "${SANDBOX}/project"

cat > "${HOME}/.omo/omo.jsonc" <<'JSONC'
{
  // base config plus two delta-only profiles that only change the oracle model
  "[opencode]": { "agents": { "oracle": { "model": "anthropic/base-oracle-model" } } },
  "profiles": {
    "gpt": { "[opencode]": { "agents": { "oracle": { "model": "openai/gpt-profile-model" } } } },
    "kimi": { "[opencode]": { "agents": { "oracle": { "model": "kimi/kimi-profile-model" } } } }
  }
}
JSONC

cat > "${XDG_CONFIG_HOME}/opencode/opencode.json" <<JSON
{ "\$schema": "https://opencode.ai/config.json", "plugin": ["${PLUGIN}"] }
JSON

cd "${SANDBOX}/project" || exit 1

# The oracle agent is the only agent this fixture retargets, so its model in the
# resolved opencode config is the observable proof of which layer won. Each call
# keeps the raw stdout/stderr in the sandbox so a failed run cannot look like a
# passing one.
resolved_oracle_model() {
  local label="$1"
  opencode debug config > "${SANDBOX}/${label}.json" 2> "${SANDBOX}/${label}.err"
  printf 'opencode debug config: exit=%s stdout_bytes=%s stderr=%s\n' \
    "$?" "$(wc -c < "${SANDBOX}/${label}.json" | tr -d ' ')" "$(tail -c 200 "${SANDBOX}/${label}.err" | tr '\n' ' ')"
  grep -o '"model": "[^"]*"' "${SANDBOX}/${label}.json" | sort -u | grep -E 'oracle-model|profile-model'
}

echo "sandbox: ${SANDBOX}"
echo "opencode: $(opencode --version)"
echo "real opencode DB sessions before: ${sessions_before}"

echo
echo "== 1. no persisted profile: plugin resolves the base [opencode] block =="
${CLI} profile current
resolved_oracle_model base

echo
echo "== 2. omo profile use gpt: persisted selection reaches opencode =="
${CLI} profile use gpt
${CLI} profile current
resolved_oracle_model persisted-gpt

echo
echo "== 3. OMO_PROFILE overrides the persisted selection for one run =="
OMO_PROFILE=kimi ${CLI} profile current
OMO_PROFILE=kimi opencode debug config > "${SANDBOX}/env-kimi.json" 2> "${SANDBOX}/env-kimi.err"
printf 'opencode debug config: exit=%s stdout_bytes=%s\n' "$?" "$(wc -c < "${SANDBOX}/env-kimi.json" | tr -d ' ')"
grep -o '"model": "[^"]*"' "${SANDBOX}/env-kimi.json" | sort -u | grep -E 'oracle-model|profile-model'

echo
echo "== 4. omo profile clear: back to the base [opencode] block =="
${CLI} profile clear
${CLI} profile current
resolved_oracle_model cleared

echo
echo "== isolation =="
sessions_after="$(sqlite3 "${REAL_DB}" 'select count(*) from session' 2>/dev/null || echo "n/a")"
host_omo_after="$(shasum -a 256 "${HOME_REAL:-/Users/$(id -un)}/.omo/omo.jsonc" 2>/dev/null || echo "n/a")"
echo "real opencode DB sessions after: ${sessions_after} (before: ${sessions_before})"
echo "host ~/.omo/omo.jsonc sha before: ${host_omo_before}"
echo "host ~/.omo/omo.jsonc sha after:  ${host_omo_after}"

rm -rf "${SANDBOX}"
echo "sandbox removed: ${SANDBOX}"
