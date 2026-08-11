#!/usr/bin/env bash
# Manual QA for `omo profile` against the built CLI (dist/cli-node/index.js),
# in a fully isolated HOME + XDG sandbox so the real ~/.omo is never touched.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLI="node ${REPO_ROOT}/dist/cli-node/index.js"

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/omo-profile-qa.XXXXXX")"
export HOME="${SANDBOX}/home"
export XDG_CONFIG_HOME="${SANDBOX}/xdg/config"
export XDG_DATA_HOME="${SANDBOX}/xdg/data"
export XDG_STATE_HOME="${SANDBOX}/xdg/state"
export XDG_CACHE_HOME="${SANDBOX}/xdg/cache"
unset OMO_PROFILE OCX_PROFILE OPENCODE_CONFIG_DIR
mkdir -p "${HOME}/.omo" "${HOME}/work" "${XDG_CONFIG_HOME}" "${XDG_DATA_HOME}" "${XDG_STATE_HOME}" "${XDG_CACHE_HOME}"

cat > "${HOME}/.omo/omo.jsonc" <<'JSONC'
{
  // sandbox fixture: two delta-only profiles over one base config
  "categories": {
    "quick": { "model": "anthropic/base-model" }
  },
  "profiles": {
    "gpt": { "categories": { "quick": { "model": "openai/gpt-5.6-sol" } } },
    "kimi": { "categories": { "quick": { "model": "kimi-for-coding/kimi-k3" } } }
  }
}
JSONC

cd "${HOME}/work" || exit 1

step() {
  printf '\n$ %s\n' "$*"
  # shellcheck disable=SC2294
  eval "$@"
  printf '[exit=%s]\n' "$?"
}

echo "sandbox HOME: ${HOME}"
step "${CLI} profile --help"
step "${CLI} profile list"
step "${CLI} profile current"
step "${CLI} profile use nope"
step "${CLI} profile use gpt"
step "${CLI} profile current"
step "${CLI} profile list"
step "OMO_PROFILE=kimi ${CLI} profile current"
step "OPENCODE_CONFIG_DIR=/tmp/does-not-exist/profiles/kimi ${CLI} profile current"
step "OMO_PROFILE=kimi ${CLI} profile use gpt"
step "cat '${HOME}/.omo/omo.jsonc'"
step "ls '${HOME}/.omo'"
step "${CLI} profile clear"
step "${CLI} profile current"
step "${CLI} profile clear"
step "cat '${HOME}/.omo/omo.jsonc'"

# A project layer must not be able to choose the active profile: it would pull in
# the user-scope-only keys a project layer is not allowed to set itself.
mkdir -p "${HOME}/work/.omo"
printf '{ "active_profile": "kimi" }\n' > "${HOME}/work/.omo/omo.jsonc"
step "${CLI} profile current"
step "${CLI} profile list"

printf '\n$ real host ~/.omo untouched check\n'
ls "$(eval echo ~"${SUDO_USER:-$(id -un)}")/.omo/omo.jsonc" >/dev/null 2>&1 && echo "host config still present, sandbox HOME was ${HOME}"

rm -rf "${SANDBOX}"
printf 'sandbox removed: %s\n' "${SANDBOX}"
