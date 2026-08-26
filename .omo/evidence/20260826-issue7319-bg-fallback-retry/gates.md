# Gates

All commands run from worktree root `/home/viprix/projects/oom-wt-7319`.

## 1. Focused tests x2 clean (post-final-edit)

```
bun test packages/omo-opencode/src/features/background-agent/manager.fallback-defer.test.ts \
         packages/omo-opencode/src/features/background-agent/fallback-deferral.test.ts
run 1: 22 pass / 0 fail / 56 expect() calls
run 2: 22 pass / 0 fail  (green-focused-pass2.txt)
```

## 2. Adjacent suite - whole touched feature directory

```
bun test packages/omo-opencode/src/features/background-agent/
=> 765 pass / 0 fail / 1950 expect() calls across 61 files
   (gates-background-agent-dir.txt)
```

Covers manager.test.ts retry describes, manager.polling.test.ts,
fallback-retry-handler.test.ts, fallback-retry-provider-exhaustion.test.ts,
atlas-subagent-fallback-retry.test.ts, error-classifier.test.ts,
session-status-classifier.test.ts, attempt lifecycle, parent-wake suites.

## 3. Touched-package typecheck (tsgo)

```
bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
=> exit 0, no output
```

## 4. Schema regeneration + freshness

```
bun run build:schema   => assets/oh-my-opencode.schema.json (+5), assets/omo.schema.json (+10)
bun test tests/omo-schema-freshness.test.ts tests/omo-config-category-drift.test.ts \
         packages/omo-opencode/src/config/schema/background-task.test.ts
=> 11 pass / 0 fail
```

## 5. git diff --check

```
git diff --check => clean (no whitespace errors)
```

## 6. Hygiene scan over changed/new files

```
grep -nE "as any|@ts-ignore|@ts-expect-error|console\.log" \
  fallback-deferral.ts fallback-deferral.test.ts manager.fallback-defer.test.ts
=> no matches; no sleeps in tests; no empty catch blocks; no suppressed types
```

## 7. Change surface

Final `git status` (excluding pre-existing shared-skills submodule self-dirt,
never staged per repo rule):

```
M  assets/oh-my-opencode.schema.json          (schema regen)
M  assets/omo.schema.json                     (schema regen)
M  docs/reference/configuration.md            (docs row)
M  packages/omo-opencode/src/config/schema/background-task.ts
M  packages/omo-opencode/src/features/background-agent/manager.ts
?? packages/omo-opencode/src/features/background-agent/fallback-deferral.ts
?? packages/omo-opencode/src/features/background-agent/fallback-deferral.test.ts
?? packages/omo-opencode/src/features/background-agent/manager.fallback-defer.test.ts
```

Note: a feasibility-probe `bun run build` regenerated unrelated tracked bundles
(omo-codex codegraph dist, omo-senpi plugin extensions). These were restored
with `git checkout --` and are not part of the change.
