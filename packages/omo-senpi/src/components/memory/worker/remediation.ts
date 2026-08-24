export function reflectionRemediation(reason: string | undefined, detail: string | undefined): string {
  const combined = `${reason ?? ""} ${detail ?? ""}`.toLowerCase()
  if (combined.includes("budget_not_met")) {
    return "run /dream again and trim or demote the largest system/ files until the committed estimate is below $SYSTEM_TOKEN_TARGET"
  }
  // Pre-spawn resolution failure: no child ever ran, so never point at child-stderr.log here.
  if (combined.includes("category_unavailable") || combined.includes("could not resolve a usable model")) {
    return "no connected provider offers a model for the memory reflection category; run /login <provider>, or pin categories.<category>.model (or memory.reflection.category) in omo.json"
  }
  // The senpi child prints `Error: Model "<selector>" not found. Use --list-models ...`, so the quoted
  // selector has to be matched too, otherwise a repeating model miss degrades to the generic child-log hint.
  if (
    combined.includes("model-not-found")
    || combined.includes("model_not_visible")
    || combined.includes("model not found")
    || /model\s+"[^"]+"\s+not found/.test(combined)
  ) {
    return "the reflection child cannot see the configured category model; adjust memory.reflection category/model in your omo config"
  }
  if (combined.includes("spawn") || combined.includes("enoent")) {
    return "senpi executable not resolvable for the reflection child; set SENPI_BIN"
  }
  if (combined.includes("api key") || combined.includes("auth_missing")) {
    return "run /login <provider>"
  }
  // Bubblewrap died during its own sandbox setup, before the reflection child started; run-dir
  // cleanup may already have removed child-stderr.log, so point at the config escape hatch instead.
  if (combined.includes("bwrap") || combined.includes("bubblewrap") || combined.includes("setting up uid map")) {
    return "bubblewrap cannot start a sandbox on this host; set memory.reflection.sandbox to \"off\" in omo.json or restore unprivileged user namespace access"
  }
  return "inspect runtime/reflection-sessions/<runId>/child-stderr.log"
}
