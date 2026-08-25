# Issue #6724 - native /mcp auth overwrites the OAuth URL without opening a browser

## Verdict

BLOCKED UPSTREAM. The defect lives entirely inside the pinned external engine
`@code-yeongyu/senpi`, not in any oh-my-openagent source file. No sanctioned fix
seam exists in this repository. Per the task's MUST NOT DO ("guessing when
blocked - STOP and report failure analysis instead"), no patch, no test, and no
PR were produced; the worktree was left clean.

## Root cause (exact locations, engine dist @code-yeongyu/senpi 2026.8.23)

1. `dist/core/extensions/builtin/mcp/auth/commands-auth-dispatch.js:29`

   ```js
   openBrowser: (url) => ctx.ui.notify(`Open this URL to authorize ${name}:\n${url.toString()}`),
   ```

   The `openBrowser` dep is wired to a transient TUI notification. It never
   invokes the OS browser. The engine already ships a real helper
   (`dist/utils/open-browser.js`, used by interactive-mode for the alt-screen
   `openUrl` and the login dialog) but the mcp auth dispatch does not use it.

2. `dist/core/extensions/builtin/mcp/auth/commands-auth.js:72-75`
   (`runInteractive()`)

   ```js
   provider = buildProvider(deps, channel.redirectUrl, (url) => deps.openBrowser?.(url));
   const begin = await beginAuthorization(provider, deps.flow);
   if (begin.authorizationUrl !== undefined)
       deps.notify(`Opening browser to authorize ${deps.serverName}...`);
   ```

   Order bug: during `beginAuthorization()` the provider fires `onRedirect`,
   which surfaces the authorization URL via notify; line 75 then immediately
   emits a second notification in the same TUI notification surface, replacing
   the URL before the user can read it. No browser open happens anywhere in the
   flow. This matches the issue report exactly.

3. Docs/runtime mismatch (`/mcp login` vs registered `auth`) is also
   engine-side: `commands.js:6-18` registers `auth`, `auth-start`,
   `auth-complete`, `logout`; the mismatched bundled MCP documentation ships
   with the engine, not with this repo (zero `/mcp login` occurrences in
   oh-my-openagent sources/docs/skills).

## Upstream fix status

- Latest published engine `2026.8.24` (npm, 2026-08-24T17:32Z) was inspected
  (tarball unpacked to /tmp/opencode/senpi-824): lines 72/75 of commands-auth.js
  and line 29 of commands-auth-dispatch.js are byte-identical to 2026.8.23.
  Not fixed upstream yet.
- Correct upstream patch shape (for code-yeongyu/senpi):
  - dispatch.js: wire `openBrowser` to the real OS opener
    (`utils/open-browser.js`) and keep the URL in the message as fallback.
  - commands-auth.js: drop or reorder the `Opening browser...` notify so it can
    never overwrite the URL notification (e.g. emit it BEFORE surfacing the
    URL, or only when a real open succeeded).
  - align bundled docs command name with `commands.js`.

## Why this repo cannot ship the fix (seams evaluated and exhausted)

1. Extension command override (omo-senpi registering `/mcp`): impossible.
   Builtins load into the same extension runner; `runner.js:618-646`
   (`resolveRegisteredCommands`) renames EVERY same-name command to `name:N`
   when count > 1, so bare `/mcp` would resolve to nothing and the typed text
   would fall through to the model as a prompt.
2. `input` event interception: unreachable for this text.
   `agent-session.js` `prompt()` dispatches registered slash commands
   (getCommand check ~line 2262) BEFORE emitting the extension `input` event
   (~line 2363), and returns early once handled.
3. `disabledBuiltinExtensions` settings route + replacement command: rejected.
   Disabling builtin id `mcp` is all-or-nothing (status/add/enable/test/logs/
   reconnect/auth all live in that one extension) and a replacement would need
   McpService + OAuth internals that the engine does not export (package
   exports are only `.`, `./rpc-entry`, `./client`). Deep-importing
   `@code-yeongyu/senpi/dist/core/...` from the adapter would be unacceptable
   coupling against an exact-pinned dependency.
4. Dependency patch mechanism: none exists in this repo (no patches/,
   no patchedDependencies); hand-patching installed dist files is not shippable.
5. Engine pin bump: no fixed version exists (verified 2026.8.24 above).
6. Docs-only PR: the mismatched docs bundle with the engine; nothing in this
   repo mentions `/mcp login`.

A failing-first regression test pinned to the broken engine behavior would leave
CI permanently red with no in-repo way to turn it green (weakening/skipping is
forbidden), so it was not added.

## What was done

- Read issue #6724 (full body + comments) via gh.
- bun install run once (node_modules present; senpi 2026.8.23 installed).
- Traced the full flow: TUI slash routing -> agent-session.prompt() ->
  extensionRunner.getCommand -> builtin mcp commands.js -> auth dispatch ->
  runInteractive/runAuthStart; verified both engine versions 2026.8.23 and
  2026.8.24.
- Verified every candidate seam listed above against the installed engine dist.
- Worktree left clean on issue/6724-mcp-auth-browser @8833800ae base; nothing
  staged or committed. (Pre-existing dirty submodule
  packages/shared-skills/upstreams/designpowers untouched, per constraints.)

## Independent re-verification (fresh redo, 2026-08-25)

Every load-bearing claim above was re-derived from scratch on branch
`issue/6724-mcp-auth-browser` @ `8833800ae`; all confirmed:

1. Issue body re-read via `gh issue view 6724 --json` (comments: none). Reporter's
   quoted runtime code matches installed dist byte-for-byte.
2. Engine dist re-read directly:
   - `node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/mcp/auth/commands-auth-dispatch.js`
     wires `openBrowser: (url) => ctx.ui.notify("Open this URL to authorize ...")`.
   - `.../auth/commands-auth.js` `runInteractive()`: `beginAuthorization()` fires
     the provider `onRedirect` (URL notify) and the very next statement emits
     `Opening browser to authorize ${serverName}...`, clobbering it in the same
     TUI notification surface. No OS browser call anywhere in the flow.
3. Slash-command dispatch order confirmed in engine `dist/core/agent-session.js`
   (~lines 2257-2276): `prompt()` resolves registered commands synchronously via
   `getCommand()` and returns early when handled; the extension `input` event
   only ever sees non-command text, so interception is unreachable.
4. Duplicate command names confirmed unviable in `dist/core/extensions/runner.js`
   (`resolveRegisteredCommands`, lines 618-646): every same-name command is
   renamed `name:N`, so registering a second `/mcp` breaks bare `/mcp` entirely.
5. Engine package exports confirmed limited to `.`, `./rpc-entry`, `./client`;
   McpService/OAuth internals are not importable for a replacement extension.
6. NEW: distribution path confirmed - published `omo-ai` declares
   `"@code-yeongyu/senpi": "2026.8.23"` as a runtime npm dependency
   (`packages/omo-native/package.json`). A repo-level bun `patchedDependencies`
   patch would only mutate this repo's dev node_modules and can never reach end
   users, so it is not a shippable fix (and no patch infra exists here anyway).
7. NEW: npm registry re-checked 2026-08-25 - latest engine is still `2026.8.24`
   (published 2026-08-24T17:32Z), previously verified byte-identical for both
   defect sites. No fixed version exists to bump to.
8. NEW: contrast proof - OMO's own OAuth surface
   (`packages/mcp-client-core/src/mcp-oauth/oauth-authorization-flow.ts`,
   `openBrowser()` at line 95, called at line 142) opens the real OS browser
   (`open` / `explorer` / `xdg-open`) with the URL. The defect is exclusively in
   the engine's builtin mcp auth dispatch; the engine even ships an unused real
   helper at `dist/utils/open-browser.js`.
9. Upstream repo `code-yeongyu/senpi` is PUBLIC with no existing issue tracking
   this bug; the source fix belongs there, followed by a pin bump + regression
   contract test in this repo.

## What was omitted

- No live Windows/TUI reproduction (issue environment is Windows 10; analysis is
  based on source-level tracing of the exact installed runtime files cited by
  the issue reporter, whose quoted code matches the inspected dist byte-for-byte).
- No upstream PR opened from here; the maintainer owns code-yeongyu/senpi and
  the fix belongs there first, followed by a pin bump + regression contract test
  in this repo.
