/**
 * Hidden dedup-context message injected after a TTSR collapse abort (issue #7135).
 *
 * The engine's own nudge is a static template that never says what the interrupted
 * reply already delivered, so the retry restates the whole answer. This hidden
 * custom message rides into the nudge-triggered turn (plain-append or steered,
 * both reach the first provider request as user-role context) and carries the
 * excerpt of the dropped body with an explicit do-not-restate instruction.
 */

export const COLLAPSE_RECOVERY_CONTEXT_TYPE = "omo-collapse-recovery:context"

export interface CollapseRecoveryExcerpt {
  head: string
  tail: string
}

export interface CollapseRecoveryContextMessage {
  customType: string
  content: Array<{ type: "text"; text: string }>
  display: false
  details: { rule: "collapse-repetition" }
}

function excerptLines(excerpt: CollapseRecoveryExcerpt): string[] {
  const lines: string[] = []
  if (excerpt.head.trim().length > 0) {
    lines.push("How it began:")
    lines.push(`"${excerpt.head}"`)
  }
  if (excerpt.tail.trim().length > 0) {
    lines.push("Where it was cut off:")
    lines.push(`"${excerpt.tail}"`)
  }
  return lines
}

export function buildCollapseRecoveryContext(excerpt: CollapseRecoveryExcerpt): CollapseRecoveryContextMessage {
  const lines = [
    "<collapse-recovery context>",
    "Your previous reply degenerated into a repetition loop and was cut off by the stream guard.",
    "The interrupted reply is no longer shown to the user. What it had already delivered, before the cut:",
    ...excerptLines(excerpt),
    "Do NOT restate, rewrite, or paraphrase that delivered content. Produce something NEW: continue from where it stopped, or give a compressed summary of the remaining points. One concise message.",
    "</collapse-recovery context>",
  ]
  return {
    customType: COLLAPSE_RECOVERY_CONTEXT_TYPE,
    content: [{ type: "text", text: lines.join("\n") }],
    display: false,
    details: { rule: "collapse-repetition" },
  }
}
