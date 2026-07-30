# Comment-checker child-stdin EPIPE QA

## Scope

Rework PR #6397 on the latest `dev` as an issue-focused fix for #6396.
The change contains only the shared comment-checker runner boundary, the Senpi
adapter boundary, deterministic regressions, regenerated Senpi extensions, and
reviewer-readable QA evidence.

## User-visible outcome

An external checker that exits before reading its hook payload no longer
terminates the Senpi host with an unhandled `EPIPE`. Exit code 2 still returns
checker feedback. A checker that crosses its deadline returns the empty result
and is terminated with SIGTERM followed by SIGKILL when required.

## Platform scope

Ubuntu 20.04 is the confirmed issue reproduction, not the only possible
environment.

- `@code-yeongyu/comment-checker@0.8.0` ships dynamically linked Linux x64
  and arm64 binaries whose highest imported GNU libc symbol version is
  `GLIBC_2.34`.
- Ubuntu 20.04 Focal and Debian 11 Bullseye ship glibc 2.31, so the checker
  can exit in the dynamic loader before consuming stdin.
- Ubuntu 22.04 Jammy ships glibc 2.35 and satisfies that specific ABI floor.
- The host crash is broader than the ABI mismatch: any checker process that
  exits before consuming stdin can produce the same child-stream `EPIPE`,
  regardless of why it exited or which host OS launched it.

Package references:

- Ubuntu libc6 search: https://packages.ubuntu.com/libc6
- Ubuntu 20.04 libc6 development package: https://packages.ubuntu.com/focal/amd64/libc6-dev
- Debian 11 glibc source package: https://packages.debian.org/source/glibc

## Evidence index

- `targeted-validation.txt`: failing-first provenance, focused regressions,
  typechecks, generated-artifact freshness, ELF ABI inspection, and omissions.
- `senpi-live-qa.txt`: real isolated Senpi execution and cleanup proof.
- `opencode-live-qa.txt`: real isolated OpenCode execution, hook proof, DB
  isolation, and cleanup proof.
- Final review reports are stored under the active ULW attempt directory and
  linked from the PR body.

## Secret handling

Raw environment dumps, credentials, authentication headers, provider payloads,
private logs, and host configuration contents are omitted.
