// Stripper for senpi cursor-cli-oauth tool protocol frames (issue #7169).
//
// The pinned senpi 2026.8.23 builtin provider serializes every Cursor tool_call event as
// `<cursor-cli-tool>${JSON.stringify(payload)}</cursor-cli-tool>\n` (renderToolFrame in
// dist/core/extensions/builtin/cursor-cli-oauth/stream.js) and routes it through pushTextDelta,
// so the frames become literal assistant text. Bodies over TOOL_RENDER_BUDGET (2000 chars) are
// sliced and suffixed with "...[truncated]", which breaks JSON parsing; both shapes must strip.
// Frames never span lines (compact JSON), so the scan is line based and skips fenced code blocks
// so model-authored examples that merely resemble the protocol survive byte-identical.

const FRAME_OPEN_TAG = "<cursor-cli-tool>"
const FRAME_CLOSE_TAG = "</cursor-cli-tool>"
const TRUNCATED_SUFFIX = "...[truncated]"
const FENCE_LINE_PATTERN = /^\s*(`{3,}|~{3,})/

function isValidFramePayload(inner: string): boolean {
  const trimmed = inner.trim()
  if (!trimmed.startsWith("{")) return false
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === "object" && parsed !== null
  } catch {
    return trimmed.endsWith(TRUNCATED_SUFFIX)
  }
}

function stripFramesFromLine(line: string): string | undefined {
  if (!line.includes(FRAME_OPEN_TAG)) return undefined
  let kept = ""
  let cursor = 0
  let removedAny = false
  for (;;) {
    const start = line.indexOf(FRAME_OPEN_TAG, cursor)
    if (start === -1) break
    const bodyStart = start + FRAME_OPEN_TAG.length
    const end = line.indexOf(FRAME_CLOSE_TAG, bodyStart)
    if (end === -1) break
    if (!isValidFramePayload(line.slice(bodyStart, end))) {
      cursor = bodyStart
      continue
    }
    kept += line.slice(cursor, start)
    cursor = end + FRAME_CLOSE_TAG.length
    removedAny = true
  }
  if (!removedAny) return undefined
  return kept + line.slice(cursor)
}

export function stripCursorCliToolFrames(text: string): string | undefined {
  if (!text.includes(FRAME_OPEN_TAG)) return undefined
  let changed = false
  let insideFence = false
  const keptLines: string[] = []
  for (const line of text.split("\n")) {
    if (FENCE_LINE_PATTERN.test(line)) {
      insideFence = !insideFence
      keptLines.push(line)
      continue
    }
    if (insideFence) {
      keptLines.push(line)
      continue
    }
    const stripped = stripFramesFromLine(line)
    if (stripped === undefined) {
      keptLines.push(line)
      continue
    }
    changed = true
    // A line that held nothing but frame material disappears entirely; upstream emits one frame
    // per line, so this keeps frame-only blocks empty (the component then drops them) instead of
    // leaving blank-line residue between prose paragraphs.
    if (stripped.trim().length > 0) keptLines.push(stripped)
  }
  if (!changed) return undefined
  return keptLines.join("\n")
}
