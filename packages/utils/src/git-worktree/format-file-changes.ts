import type { GitFileStat } from "./types"

const MAX_PATHS_PER_GROUP = 20
const MAX_SUMMARY_BYTES = 32 * 1024

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/")
}

interface FileChangeGroup {
  heading: string
  noun: string
  files: GitFileStat[]
  describe: (stat: GitFileStat) => string
}

function buildGroups(stats: GitFileStat[]): FileChangeGroup[] {
  return [
    {
      heading: "Modified files:",
      noun: "modified",
      files: stats.filter((s) => s.status === "modified"),
      describe: (f) => `  ${f.path}  (+${f.added}, -${f.removed})`,
    },
    {
      heading: "Created files:",
      noun: "created",
      files: stats.filter((s) => s.status === "added"),
      describe: (f) => `  ${f.path}  (+${f.added})`,
    },
    {
      heading: "Deleted files:",
      noun: "deleted",
      files: stats.filter((s) => s.status === "deleted"),
      describe: (f) => `  ${f.path}  (-${f.removed})`,
    },
  ]
}

export function formatFileChanges(stats: GitFileStat[], notepadPath?: string): string {
  if (stats.length === 0) return "[FILE CHANGES SUMMARY]\nNo file changes detected.\n"

  const lines: string[] = ["[FILE CHANGES SUMMARY]"]
  let truncated = false

  for (const group of buildGroups(stats)) {
    if (group.files.length === 0) continue
    lines.push(group.heading)
    const shown = group.files.slice(0, MAX_PATHS_PER_GROUP)
    for (const f of shown) {
      lines.push(group.describe(f))
    }
    if (group.files.length > shown.length) {
      truncated = true
      lines.push(`  ...and ${group.files.length - shown.length} more ${group.noun} files`)
    }
    lines.push("")
  }

  // Byte cap applies to the header + group listing only; the notepad block is
  // appended afterwards so [NOTEPAD UPDATED] always survives truncation.
  let byteTruncated = false
  while (lines.length > 1 && Buffer.byteLength(lines.join("\n"), "utf8") > MAX_SUMMARY_BYTES) {
    lines.pop()
    byteTruncated = true
  }
  if (byteTruncated) {
    truncated = true
    lines.push(`  ...summary truncated at ${MAX_SUMMARY_BYTES} bytes`)
    lines.push("")
  }

  if (truncated) {
    lines.push(`Output truncated: true (total changed files: ${stats.length})`)
    lines.push("")
  }

  if (notepadPath) {
    const normalizedNotepadPath = normalizePath(notepadPath)
    const notepadStat = stats.find((s) => {
      const normalizedPath = normalizePath(s.path)
      return normalizedPath === normalizedNotepadPath
    })
    if (notepadStat) {
      lines.push("[NOTEPAD UPDATED]")
      lines.push(`  ${notepadStat.path}  (+${notepadStat.added})`)
      lines.push("")
    }
  }

  return lines.join("\n")
}
