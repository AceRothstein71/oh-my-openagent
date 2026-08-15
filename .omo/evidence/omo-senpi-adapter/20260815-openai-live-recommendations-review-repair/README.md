# Isolated Senpi live recommendation QA

Result: **PASS**

The exact lockfile dependency set was freshly installed with Bun 1.3.12. The current worktree Senpi
extension was then rebuilt and driven through an isolated Senpi 2026.8.14 installation with the
repository's recommendation harness:

```sh
SENPI_BIN="<installed-senpi>/dist/cli.js" \
node packages/omo-senpi/scripts/qa/openai-recommendations-e2e.mjs \
  --evidence-dir \
  .omo/evidence/omo-senpi-adapter/20260815-openai-live-recommendations-review-repair
```

Observed behavior:

- Automatic categories completed on `artistry=Sol/xhigh`, `writing=Sol/medium`,
  `visual-engineering=Sol/high`, and `quick=Luna-fast`.
- Curated `explore` and `librarian` children completed on Luna-fast/low.
- `architect` remained unavailable without Fable 5.
- The explicit writing override completed on Terra/low.
- The sandbox project config, real OMO config, and real agent credential digests remained unchanged.
- Both temporary sandboxes were removed.

The JSON verdicts are sanitized machine-readable evidence. Raw provider traffic, credentials,
endpoint URLs, environment dumps, and host-specific paths are intentionally omitted.
