import { describe, expect, test } from "bun:test"
import { prepareDelegateTaskArgs } from "./tool-argument-preparation"
import type { ToolContextWithMetadata } from "./types"

function createContextWithCapturedTitles(): { ctx: ToolContextWithMetadata; titles: string[] } {
  const titles: string[] = []
  const ctx: ToolContextWithMetadata = {
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "sisyphus",
    abort: new AbortController().signal,
    metadata: async (patch) => {
      if (typeof patch.title === "string") {
        titles.push(patch.title)
      }
    },
  }
  return { ctx, titles }
}

describe("prepareDelegateTaskArgs", () => {
  test("#given a category-only delegation without an explicit description #when args are prepared #then the generated description and the TUI title surface the category so it is not invisible (issue #6854)", async () => {
    // given
    const { ctx, titles } = createContextWithCapturedTitles()

    // when
    const result = await prepareDelegateTaskArgs(
      { prompt: "fix the flaky login test", category: "quick", load_skills: [] },
      ctx,
    )

    // then - routing stays on sisyphus-junior, but every display string carries the category
    expect(result.subagent_type).toBe("Sisyphus-Junior")
    expect(result.category).toBe("quick")
    expect(result.descriptionSource).toBe("generated")
    expect(result.description).toBe("fix the flaky login (category: quick)")
    expect(titles[0]).toBe("fix the flaky login (category: quick)")
  })

  test("#given an explicit description with a category #when args are prepared #then the explicit description carries the category suffix", async () => {
    // given
    const { ctx, titles } = createContextWithCapturedTitles()

    // when
    const result = await prepareDelegateTaskArgs(
      { prompt: "do work", description: "Refactor auth module", category: "deep", load_skills: [] },
      ctx,
    )

    // then
    expect(result.description).toBe("Refactor auth module (category: deep)")
    expect(titles[0]).toBe("Refactor auth module (category: deep)")
  })

  test("#given no category #when args are prepared #then the description is byte-identical with no category suffix", async () => {
    // given
    const { ctx, titles } = createContextWithCapturedTitles()

    // when
    const result = await prepareDelegateTaskArgs(
      { prompt: "explore the codebase", subagent_type: "explore", load_skills: [] },
      ctx,
    )

    // then
    expect(result.description).toBe("explore the codebase")
    expect(result.description).not.toContain("(category:")
    expect(titles[0]).toBe("explore the codebase")
  })
})
