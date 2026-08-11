import { Command } from "commander"
import { runProfileClear, runProfileCurrent, runProfileList, runProfileUse } from "./profile"

export function createProfileCommand(): Command {
  const profile = new Command("profile").description("Switch between named OMO configuration profiles")

  profile
    .command("list")
    .description("List profiles defined in your omo config, marking the active one")
    .action(() => {
      process.exit(runProfileList())
    })

  profile
    .command("use <name>")
    .description("Persist <name> as the active profile in ~/.omo/omo.jsonc")
    .action((name: string) => {
      process.exit(runProfileUse(name))
    })

  profile
    .command("current")
    .description("Show the active profile and where its activation comes from")
    .action(() => {
      process.exit(runProfileCurrent())
    })

  profile
    .command("clear")
    .description("Remove the persisted active profile and report the resulting active selection")
    .action(() => {
      process.exit(runProfileClear())
    })

  profile.addHelpText("after", `
Examples:
  $ omo profile list        # Show every profile with the active marker
  $ omo profile use gpt     # Persist "gpt" so plain opencode picks it up
  $ omo profile current     # Show the active profile and its source
  $ omo profile clear       # Drop the persisted profile and show what remains active

Activation order (highest first): OMO_PROFILE, OCX_PROFILE, an OPENCODE_CONFIG_DIR
ending in profiles/<name>, then the persisted "active_profile" key.
`)

  return profile
}
