# Review-repair RED/GREEN evidence

## RED

The review boundaries were first converted into regressions. The first focused run exposed seven
failures covering upstream-authoritative identity, incomplete-inventory listing/resolution drift,
and copied bare-ID automatic routing. Critic review then produced four further expected failures for
invalid upstream lookup signals and prompt-only alias projection.

## GREEN

After the fixes and Oracle's final boundary additions, the focused command passed:

```sh
bun test \
  packages/omo-config-core/src/models/openai-only-model-recommendations.test.ts \
  packages/senpi-task/src/category/openai-only-recommendations.test.ts \
  packages/senpi-task/src/agents/openai-only-recommendations.test.ts
```

Observed result: **52 passed, 0 failed**. This includes invalid, throwing, non-string, and oversized
upstream IDs; malformed inventories; copied bare/nested IDs; prompt-only config; verified aliases;
and explicit user model/fallback precedence.

## Full locked-dependency verification

After `bun install --frozen-lockfile` installed the pinned Senpi 2026.8.14 peer:

- `bun test packages/omo-config-core`: **179 passed, 0 failed**.
- `bun test packages/senpi-task`: **1,411 passed, 0 failed**.
- `bun run test:senpi`: **1,569 passed, 1 Darwin-only skip, 0 failed**.
- Typechecks for `omo-config-core`, `senpi-task`, `omo-senpi`, and `omo-opencode`: **PASS**.
- Root build, generated Senpi extension freshness, staged diff check: **PASS**.
- Isolated real Senpi 2026.8.14 automatic and explicit-override scenarios: **PASS**.

No credentials, URLs, auth headers, environment dumps, or host-specific paths are included.
