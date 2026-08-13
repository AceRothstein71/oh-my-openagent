# Review-repair RED/GREEN evidence

Four review boundaries were converted to focused regressions before their fixes.

## RED

The initial focused run exited non-zero with four failures:

1. `senpi-task` still declared and imported `@oh-my-opencode/model-core`.
2. An explicit agent fallback on `unrelated/openai/gpt-5.6-sol` disappeared from the persisted
   runtime fallback chain.
3. A verified `codexlb/fable-balanced -> claude-fable-5` alias opened the architect gate but could
   not resolve its matching fallback rung.
4. The source-boundary audit found the forbidden package dependency/import.

These failures matched the four actionable GitHub review comments; no unrelated assertion failed.

## GREEN

After moving the policy/compiler to `omo-config-core`, preserving explicit agent availability, and
projecting exact verified upstream aliases for every model family, the focused command passed:

```sh
bun test \
  packages/senpi-task/src/model-core-coupling-audit.test.ts \
  packages/senpi-task/src/agents/openai-only-recommendations.test.ts \
  packages/senpi-task/src/category/openai-only-recommendations.test.ts \
  packages/omo-config-core/src/models/openai-only-model-recommendations.test.ts \
  packages/omo-opencode/src/cli/openai-only-model-catalog.test.ts
```

Observed result: **46 passed, 0 failed**. A final tuning-suffix compatibility check additionally
proved spaced, colon, and parenthesized explicit fallback spellings all remain user-authoritative.

No credentials, URLs, auth headers, environment dumps, or host-specific paths are included.
