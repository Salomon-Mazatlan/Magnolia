/**
 * Keep codepoint anchors aligned when transcript text is edited in place.
 *
 * Codes, quotes and content memos all anchor to the transcript as [start, end)
 * Unicode-codepoint ranges (REFI-QDA positions; see ./unicode.ts). When the
 * user edits the text in transcription mode — fixing a typo inside a coded
 * passage, inserting a word before it — those anchors must shift with the text,
 * or every code below the edit drifts onto the wrong words.
 *
 * A single textarea onChange is always ONE contiguous edit, so we diff the old
 * and new text by their common prefix + common suffix and treat everything in
 * between as a replacement.
 */

export interface TextEdit {
  /** Codepoint index where the change begins (common-prefix length). */
  start: number
  /** Codepoint index in the OLD text where the change ends. */
  oldEnd: number
  /** Codepoint index in the NEW text where the change ends. */
  newEnd: number
}

/**
 * Diff two strings as a single contiguous edit, in Unicode codepoints.
 * Returns null when the strings are identical.
 */
export function computeTextEdit(oldText: string, newText: string): TextEdit | null {
  if (oldText === newText) return null
  const oldCp = [...oldText]
  const newCp = [...newText]
  const oldLen = oldCp.length
  const newLen = newCp.length

  // Common prefix.
  let start = 0
  const minLen = Math.min(oldLen, newLen)
  while (start < minLen && oldCp[start] === newCp[start]) start++

  // Common suffix — never overlapping the prefix we already consumed.
  let oldEnd = oldLen
  let newEnd = newLen
  while (oldEnd > start && newEnd > start && oldCp[oldEnd - 1] === newCp[newEnd - 1]) {
    oldEnd--
    newEnd--
  }

  return { start, oldEnd, newEnd }
}

/**
 * Map a single codepoint offset from the old text to the new text.
 * `side` resolves offsets that land *inside* the replaced region: a range
 * start clamps to the edit start, a range end clamps to the edit's new end —
 * so an edit wholly inside a coded range grows/shrinks the range instead of
 * leaving a boundary stranded in deleted text.
 */
export function adjustOffset(pos: number, edit: TextEdit, side: 'start' | 'end'): number {
  const delta = edit.newEnd - edit.oldEnd
  if (pos <= edit.start) return pos
  if (pos >= edit.oldEnd) return pos + delta
  return side === 'start' ? edit.start : edit.newEnd
}

/**
 * Shift a [start, end) codepoint range for a text edit. Returns null when the
 * range collapses to empty — its text was entirely deleted, so the anchor
 * should be dropped rather than left as a zero-width artifact.
 */
export function adjustRange(
  start: number,
  end: number,
  edit: TextEdit
): { start: number; end: number } | null {
  const newStart = adjustOffset(start, edit, 'start')
  const newEnd = adjustOffset(end, edit, 'end')
  if (newEnd <= newStart) return null
  return { start: newStart, end: newEnd }
}
