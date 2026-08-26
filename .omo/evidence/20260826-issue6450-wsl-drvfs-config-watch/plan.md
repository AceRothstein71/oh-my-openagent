# Plan: issue 6450 - [Senpi][WSL] Config watcher hangs on drvfs projects after updates

Worktree: this repository's worktree root (branch fix/wsl-drvfs-config-watch-6450, base origin/dev @ 8c57e463e)

## Root cause (from issue + code read)

`resolveOmoConfigWatchTargetResolution` in
`packages/omo-senpi/src/components/config-watch/paths.ts` emits `kind: "dir"`
targets for (a) every existing `.omo` directory from cwd up to HOME-or-root and
(b) EVERY ancestor directory as a creation watch. Senpi's host maps each `dir`
target to a RECURSIVE watch. On WSL, Windows drives are Plan 9 mounts
(`statfs().type === 0x01021997`, decimal 16914839); installing recursive
inotify watches over a large 9P tree blocks the Node main thread for minutes
(`D state`, `p9_client_rpc`). There is no filesystem-type guard anywhere in the
package today.

## Change set

1. `packages/omo-senpi/src/components/config-watch/paths.ts`
   - Add exported `PLAN9_FILE_SYSTEM_TYPE = 0x01021997`.
   - Add injectable seam `resolveFileSystemType?: (path: string) => number | null`
     on `ResolveOmoConfigWatchTargetsOptions`. Default implementation:
     Linux-only `node:fs.statfsSync(path).type`, `null` on any error or on
     non-Linux platforms or when the runtime lacks `statfsSync` (bun-types has
     no declaration for it; resolve structurally with an optional-property
     intersection, no `as any`).
   - When the project cwd resolves to Plan 9: emit NO project `.omo` config
     targets and NO ancestor creation targets (the recursive-watch hang source).
     Startup config loading is untouched (loader lives in omo-config-core).
   - User config targets (`~/.omo` config watch or its parent creation watch)
     are emitted only when that path itself is not on Plan 9.
   - Fallback semantics documented in-code: config changes on affected paths
     are picked up on the next session instead of hot reload.
   - `userConfigCreationWatched` / `userConfigCreationDiscovery` stay derived
     from SURVIVING targets (existing logic), so dropping targets updates them
     automatically.

2. `packages/omo-senpi/src/components/config-watch/paths.test.ts`
   - Regression tests injecting a fake fs-type resolver:
     a. drvfs project under a simulated `/mnt/e` root: no project `.omo` target,
        no ancestor creation target anywhere under the mount; native user
        config target preserved; `userConfigCreationWatched` true.
     b. drvfs HOME: user config targets dropped too; discovery reports
        `reload_required`.
     c. native ext4 everywhere via the seam: full legacy target set unchanged.
     d. unknown fs type (`null`): fail open to current behavior.
     e. non-linux platform with default detection: unchanged behavior
        (platform gate).
     f. pin `PLAN9_FILE_SYSTEM_TYPE === 16914839` (guards against the
        visually-identical tmpfs magic 0x01021994).

3. `packages/omo-senpi/plugin/extensions/*.js` regenerated via
   `node packages/omo-senpi/plugin/scripts/build-extension.mjs` (tracked
   generated artifacts; CI runs the same script with `--check`).

No changes to `index.ts` (component) or to omo-config-core (startup loading).

## Verification plan

- RED: new tests run before the fix and fail on real assertions.
- GREEN: focused `bun test packages/omo-senpi/src/components/config-watch/`.
- Gates x2 over identical final tree: focused tests + full package suite
  (`bun test packages/omo-senpi`), `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`,
  `git diff --check`, hygiene grep for `as any|@ts-ignore|console\.log` on
  changed paths.
- QA under /tmp/opencode/issue-6450/ with sandboxed HOME/XDG_* env: drive the
  BUILT bundle registration surface for the native-fs path (payload must be
  byte-equivalent to pre-fix) and record honestly that the Plan 9 branch cannot
  be reproduced locally (no WSL); it is covered by the injected-seam unit tests.

## Honest limitations

- WSL/drvfs cannot be reproduced on this machine; the Plan 9 detection path is
  verified only through the injected resolver seam plus a real-statfs probe of
  the default resolver on ext4/tmpfs mounts.
- No `senpi` binary installed: live senpi driver QA reports SKIP and is not run.
