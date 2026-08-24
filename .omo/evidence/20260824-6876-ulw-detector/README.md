# Issue #6876: OpenCode ultrawork keyword detector hijacks ulw-research / ulw-plan

## Root cause

`packages/omo-opencode/src/hooks/keyword-detector/constants.ts:36` used
`pattern: /\b(ultrawork|ulw)\b/i` in the `KEYWORD_DETECTORS` ultrawork entry.
`-` is not a word character, so `\b` terminates right before the hyphen and the
bare `ulw` alternative matches inside `ulw-research` / `ulw-plan`, injecting the
full ultrawork mode prompt on top of those skill routes.

The same regex also existed at `packages/omo-opencode/src/plugin/ultrawork-model-override.ts:11`
(`ULTRAWORK_PATTERN`). `detectUltrawork()` is wired independently of the keyword
detector (`src/plugin/chat-message.ts:149`), so prose containing `ulw-research`
also force-switched the agent model/variant when ultrawork config was present.

The Codex copy already guards this (`packages/omo-codex/plugin/components/ultrawork/src/codex-hook.ts:5`,
`/(?:ultrawork|ulw(?!-(?:plan|research)))/i`); the Senpi copy tracks compound
keywords separately from plain ultrawork. The OpenCode copies did not.

## Fix

Port the Codex negative lookahead to both OpenCode patterns:

- `constants.ts`: `/\b(?:ultrawork|ulw(?!-(?:plan|research)))\b/i`
- `ultrawork-model-override.ts`: `/\b(?:ultrawork|ulw(?!-(?:plan|research)))\b/i`

Standalone `ulw` / `ultrawork` still trigger plain ultrawork; `ulw-plan` /
`ulw-research` no longer match (they route to their own skills).

## WHAT TESTED

- Failing-first regression tests, added BEFORE the fix:
  - `packages/omo-opencode/src/hooks/keyword-detector/index.test.ts`
    ("keyword-detector word boundary"): prose `please run ulw-research on this topic`
    and `ulw-plan 해줘` must not inject `<ultrawork-mode>` nor show the
    "Ultrawork Mode Activated" toast.
  - `packages/omo-opencode/src/plugin/ultrawork-model-override.test.ts`
    ("detectUltrawork"): `detectUltrawork("please run ulw-research ...")` and
    `detectUltrawork("ulw-plan 해줘")` must be false.
  - Both directions covered: standalone `ulw` positive cases already existed
    (index.test.ts "should trigger ultrawork on standalone 'ulw' keyword",
    model-override.test.ts "should detect ulw keyword"); compound negatives are new.
- Scoped suites after the fix: `bun test packages/omo-opencode/src/hooks/keyword-detector/
  packages/omo-opencode/src/plugin/ultrawork-model-override.test.ts
  packages/omo-opencode/src/plugin/ultrawork-variant-availability.test.ts`
- `bun run typecheck` (tsgo root + script + all workspace packages).
- Repo-wide grep over `*.test.ts` for `ulw-research|ulw-plan` to confirm no test
  pinned the old hijack behavior.

## OBSERVED

- RED (before fix): exactly the 4 new tests failed; all 78 pre-existing tests in
  the two files passed. Failures:
  - detectUltrawork > should not detect compound skill keyword ulw-research
  - detectUltrawork > should not detect compound skill keyword ulw-plan
  - keyword-detector word boundary > should NOT trigger ultrawork when prose contains the 'ulw-research' skill keyword
  - keyword-detector word boundary > should NOT trigger ultrawork when prose contains the 'ulw-plan' skill keyword
- GREEN (after fix): 128 pass / 0 fail across 9 files (291 expect calls) — see test-green.txt.
- Typecheck: exit 0 — see typecheck.txt.
- Behavior parity table (matches the issue reproduction):
  - `ulw` -> matches (plain ultrawork fires)
  - `ultrawork` -> matches
  - `please run ulw-research` -> no match
  - `ulw-research` -> no match
  - `ulw-plan 해줘` -> no match
  - `ulw plan this` (space, not hyphen) -> still matches plain ultrawork

## WHY IT IS ENOUGH

The regression tests drive the real production surfaces end to end: the
keyword-detector transform hook (message injection + toast) and the chat.message
model-override gate (`detectUltrawork`), asserting on observable behavior
(injected text, toast title, boolean detection) rather than regex internals.
Both directions are pinned, so a future revert to substring matching fails CI,
and an over-tight pattern that breaks standalone `ulw` also fails CI. The scoped
suites cover every consumer of the two changed constants; nothing else imports
them (verified by grep). Remaining risk is limited to surfaces outside this repo's
OpenCode adapter that intentionally keep their own detectors (Codex already fixed,
Senpi already separates matchedUlw vs matchedUltrawork).

## OMITTED

- `packages/omo-opencode/src/hooks/start-work/parse-user-request.ts:1` shares the
  same regex shape but different semantics: it strips mode keywords out of a
  `/start-work <user-request>` plan name. Not part of the reported hijack; left
  untouched to keep the diff minimal.
- `HYPERPLAN_ULTRAWORK_PATTERN` (constants.ts:15) requires explicit adjacent
  `hyperplan`/`hpp`; not touched.
- Live `opencode run` harness QA was not driven; verification is unit-level via
  the hook + override gates. No secrets appear in any artifact in this directory.
