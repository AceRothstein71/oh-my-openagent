# PR #6397 Conflict Resolution Evidence

## Scope

Resolve the merge conflict between PR head
`18688779215fcee5242a661996b52333ec53b3db` and `origin/dev`
`bb06bdbcc8ca2d7f3cc1f83b774d6b1c47bcdd4e` without losing the PR's
comment-checker stdin `EPIPE` containment or newer Senpi bundle behavior from
`dev`.

## Evidence index

- `merge-conflict-red.txt`: exact merge-conflict reproduction.
- `timeout-red-green.txt`: deadline-contract RED/GREEN proof.
- `review-red-green.txt`: real-Node adapter-host review fix proof.
- `scoped-validation.txt`: focused tests, typechecks, and generated-bundle check.
- `full-gates.txt`: Senpi gate, root build, Codex gate, and bundle check.
- `live-harness-qa.txt`: Senpi, OpenCode, and Codex real-harness proof.
- `cleanup.txt`: process, port, sandbox, and eventual worktree cleanup receipts.
- `review-verdicts.txt`: five-lane HEAVY review and conditional-fix loop.
- `ci-red-green.txt`: Ubuntu stale-bundle RED→GREEN and latest-base sync.
- `provenance-red-green.txt`: tamper-proof deterministic bundle checking.

## Evidence policy

Raw environment dumps, credentials, authentication headers, and private logs
are omitted. Commands and behavior-relevant output are retained in sanitized,
reviewer-readable form.
