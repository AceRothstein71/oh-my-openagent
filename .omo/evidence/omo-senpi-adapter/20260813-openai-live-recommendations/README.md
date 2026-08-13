# Isolated Senpi live recommendation QA

Result: **PASS**

The current worktree Senpi extension was rebuilt, then driven through real Senpi 2026.8.11-4:

```sh
SENPI_BIN="<installed-senpi>/dist/cli.js" \
node packages/omo-senpi/scripts/qa/openai-recommendations-e2e.mjs \
  --evidence-dir \
  .omo/evidence/omo-senpi-adapter/20260813-openai-live-recommendations/review-repair
```

Observed behavior:

- Automatic routes completed with `artistry=Sol/xhigh`, `writing=Sol/medium`,
  `visual-engineering=Sol/high`, and `quick=Luna-fast`.
- Curated `explore` and `librarian` children completed on Luna-fast/low.
- `architect` remained unavailable without Fable 5.
- An explicit writing override completed on Terra/low.
- The sandbox project config, real OMO config, and real agent credential digests remained unchanged.
- Every temporary sandbox was removed and no child process leaked.

The three JSON files in `review-repair/` are the sanitized machine-readable verdict. Raw provider
traffic and environment data are intentionally omitted because they are unnecessary and may contain
sensitive material.
