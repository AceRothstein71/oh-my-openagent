import type { DelegateTaskArgs } from "./types"

export function getPersistedBackgroundTaskDescription(args: DelegateTaskArgs, agent: string): string {
  if (args.descriptionSource === "generated") {
    // Issue #6854: keep the category visible in background session titles.
    // The category is a validated config key, never prompt-derived, so it is
    // safe to persist even when the prompt summary itself is redacted.
    return `${agent} background task${args.category ? ` (category: ${args.category})` : ""}`
  }

  return args.description
}
