# Cleanup receipt

## QA processes

- Fake LLM server (`fake-llm.ts`, port 46111): killed. Port verified closed.
- Sandbox `opencode serve` (port 46112): killed via fuser -k after pkill raced
  the tool timeout. Port verified closed (`QA_PORTS_CLOSED`).
- No generic `pkill opencode` was used: the user's own unrelated long-running
  opencode processes (PIDs 6856, 1687169, 1724266) were identified first and
  deliberately left untouched.

## Filesystem

- All QA artifacts live under `/tmp/opencode/qa7319/` (sandbox XDG dirs, fake
  LLM, driver scripts, driver logs). Left in place as reproducible evidence;
  nothing under the real user home was written by QA.
- Worktree transient `/tmp/opencode/wave-diff.txt`, `/tmp/opencode/build-7319.log`
  (audit scratch, outside repo).

## Repo tree (final change surface)

```
M  assets/oh-my-opencode.schema.json
M  assets/omo.schema.json
M  docs/reference/configuration.md
M  packages/omo-opencode/src/config/schema/background-task.ts
M  packages/omo-opencode/src/features/background-agent/manager.ts
?? packages/omo-opencode/src/features/background-agent/fallback-deferral.ts
?? packages/omo-opencode/src/features/background-agent/fallback-deferral.test.ts
?? packages/omo-opencode/src/features/background-agent/manager.fallback-defer.test.ts
```

Untracked evidence dir `.omo/evidence/20260826-issue7319-bg-fallback-retry/`
(gitignored path; uncommitted per task constraints).

Pre-existing dirt intentionally NOT touched / NOT staged:
- `packages/shared-skills/upstreams/taste-skill` + `ui-ux-pro-max` submodule
  self-dirt (known repo behavior).
- Build-regenerated codex/senpi bundles from the feasibility probe were
  restored to HEAD via `git checkout --` before final audit.

No commits. No pushes. No PRs.
