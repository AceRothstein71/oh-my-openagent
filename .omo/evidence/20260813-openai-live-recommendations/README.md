# OpenAI-only live recommendation QA

Result: **PASS**

This directory contains reviewer-visible evidence for issue #6813 and PR #6818.
The change was exercised through both affected harnesses after the review fixes:

- Real OpenCode 1.18.18 loaded the current worktree plugin in an isolated HOME/XDG sandbox.
- Real Senpi 2026.8.11-4 loaded the rebuilt current worktree extension and completed all
  recommended category and curated-agent children.
- Focused regression tests cover the forbidden dependency, explicit nested fallback preservation,
  verified non-OpenAI aliases, unverified provider rejection, and explicit-user precedence.
- Package tests, four package typechecks, `bun run test:senpi`, and `bun run build` passed.

No user config was changed. No real model credential, endpoint URL, auth header, environment dump,
or raw secret-bearing log is committed. Temporary sandboxes and the temporary OpenCode install were
removed after capture.

See `opencode/README.md` for the OpenCode command and observations. The sanitized Senpi runtime
verdicts are under the sibling
`.omo/evidence/omo-senpi-adapter/20260813-openai-live-recommendations/review-repair/` directory.
