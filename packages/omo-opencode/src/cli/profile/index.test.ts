import { describe, expect, test } from "bun:test"
import { createProfileCommand } from "./index"

describe("createProfileCommand", () => {
  test("#given the profile command group #when built #then it exposes list, use, current, and clear", () => {
    // given
    const command = createProfileCommand()

    // when
    const subcommands = command.commands.map((subcommand) => subcommand.name()).sort()

    // then
    expect(command.name()).toBe("profile")
    expect(subcommands).toEqual(["clear", "current", "list", "use"])
  })

  test("#given the use subcommand #when inspected #then it requires a profile name argument", () => {
    // given
    const command = createProfileCommand()

    // when
    const use = command.commands.find((subcommand) => subcommand.name() === "use")

    // then
    expect(use?.registeredArguments.map((argument) => argument.required)).toEqual([true])
  })
})
