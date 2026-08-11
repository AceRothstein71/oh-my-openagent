#!/usr/bin/env bash
# Codex-side check for the shared config change. No file under packages/omo-codex
# changed, but the Codex plugin reads omo config through the same core, so this
# drives the real Codex config loader (getCodexOmoConfig) against an isolated
# HOME + CODEX_HOME and shows the persisted profile folding into the codex view.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/omo-profile-codex-qa.XXXXXX")"
REAL_CODEX_TOML="${HOME}/.codex/config.toml"
real_toml_before="$(shasum -a 256 "${REAL_CODEX_TOML}" 2>/dev/null || echo 'n/a')"

export HOME="${SANDBOX}/home"
export CODEX_HOME="${SANDBOX}/codex"
unset OMO_PROFILE OCX_PROFILE OPENCODE_CONFIG_DIR
mkdir -p "${HOME}/.omo" "${CODEX_HOME}" "${SANDBOX}/project"

cat > "${HOME}/.omo/omo.jsonc" <<'JSONC'
{
  "categories": { "quick": { "model": "anthropic/base-model" } },
  "profiles": {
    "gpt": { "[codex]": { "categories": { "quick": { "model": "openai/gpt-profile-model" } } } }
  }
}
JSONC

cat > "${SANDBOX}/probe.ts" <<TS
import { getCodexOmoConfig } from "${REPO_ROOT}/packages/omo-codex/plugin/shared/src/config-loader.ts"

const config = getCodexOmoConfig({ cwd: "${SANDBOX}/project" })
console.log("codex quick model:", config.categories?.["quick"]?.model)
TS

echo "sandbox HOME: ${HOME}"
echo
echo "== no persisted profile =="
bun "${SANDBOX}/probe.ts"

echo
echo "== omo profile use gpt =="
node "${REPO_ROOT}/dist/cli-node/index.js" profile use gpt
bun "${SANDBOX}/probe.ts"

echo
echo "== OMO_PROFILE=nonexistent overrides and degrades to base =="
OMO_PROFILE=nonexistent bun "${SANDBOX}/probe.ts"

echo
echo "== isolation =="
real_toml_after="$(shasum -a 256 "${REAL_CODEX_TOML}" 2>/dev/null || echo 'n/a')"
echo "real ~/.codex/config.toml sha before: ${real_toml_before}"
echo "real ~/.codex/config.toml sha after:  ${real_toml_after}"
echo "sandbox CODEX_HOME contents: $(ls -A "${CODEX_HOME}" | tr '\n' ' ')"

rm -rf "${SANDBOX}"
echo "sandbox removed: ${SANDBOX}"
