## 2026-08-12 — Publish and control native tasks over RPC

The task component now emits every available child-session, result, error, persisted/live run-stat,
and semantic live-progress field through `omo.task.updated`. It owns one deduplicated child
subscription per live resident task and releases subscriptions when a task settles, leaves the
session, or the session shuts down.

Modern Senpi hosts also receive session-scoped `omo.task.output`, `omo.task.send`, and
`omo.task.cancel` request handlers. These handlers reuse the existing task tool policies, reject
malformed or foreign-session requests, never enable `all_scope`, and remain an optional no-op on
older hosts that expose only `pi.rpc.emit`.

Future changes must preserve the single live-subscription owner, semantic snapshot deduplication,
parent-session scoping, and old-host compatibility.

## 2026-08-06 — Refresh local Senpi installs before activation

Source installs now rebuild every generated OMO Senpi artifact even when the previous bundle is
complete, and they replace older settings entries whose package manifest is also
`@code-yeongyu/omo-senpi`. This prevents a copied, stale extension from continuing to run legacy
task lifecycle code after the source tree has gained crash-revival fixes.

Keep the distinction between source and packed installs: source installs must refresh generated
artifacts, while packed installs must verify their immutable staged artifacts without attempting a
build. Do not remove package-identity replacement; loading stale and current OMO package paths
together can register duplicate components and retain obsolete task behavior.

The parent-restart QA driver proves the integration boundary by SIGKILLing a real Senpi parent,
reopening the same session and task state, and requiring the original in-process child task to
continue without becoming `lost`. It also verifies process and temporary sandbox cleanup.
