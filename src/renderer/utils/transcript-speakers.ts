import type { ParsedTranscript } from './timestamp-parser'

/** A speaker detected in an imported transcript, with everything the
 *  speaker-coding popup needs: where this speaker's text sits (for coding) and
 *  the best clip to preview (for the play button). */
export interface DetectedSpeaker {
  /** The label/name from the file (e.g. "S00", or a WebVTT `<v>` name). */
  id: string
  /** How many segments (lines) this speaker has. */
  segmentCount: number
  /** Codepoint ranges of this speaker's lines in the transcript content —
   *  one per segment — so each can be turned into a coded selection. */
  ranges: { startChar: number; endChar: number }[]
  /** Start time (seconds) of this speaker's LONGEST segment — where the
   *  preview plays from. */
  previewStart: number
  /** End time (seconds) of that longest segment, so the preview can stop at
   *  the segment boundary if it's shorter than the requested clip. */
  previewEnd: number
}

/**
 * Group a parsed transcript's segments by speaker, in first-appearance order.
 * Segments with no speaker label are ignored, so a transcript whose format
 * doesn't identify speakers yields an empty list (and no popup). Char ranges
 * are codepoint offsets into `parsed.content`, matching how the rest of the
 * app addresses transcript text.
 */
export function detectSpeakers(parsed: ParsedTranscript): DetectedSpeaker[] {
  const lines = parsed.content.split('\n')
  // Codepoint offset of each line's start.
  const lineStart: number[] = []
  let cp = 0
  for (const line of lines) {
    lineStart.push(cp)
    cp += [...line].length + 1 // +1 for the '\n'
  }

  const byId = new Map<string, DetectedSpeaker>()
  const order: string[] = []
  parsed.segments.forEach((seg, i) => {
    const id = seg.speaker
    if (!id || i >= lines.length) return
    const startChar = lineStart[i]
    const endChar = startChar + [...lines[i]].length
    let sp = byId.get(id)
    if (!sp) {
      sp = { id, segmentCount: 0, ranges: [], previewStart: seg.startTime, previewEnd: seg.endTime }
      byId.set(id, sp)
      order.push(id)
    }
    sp.segmentCount++
    sp.ranges.push({ startChar, endChar })
    // Keep the longest segment as the preview clip.
    if (seg.endTime - seg.startTime > sp.previewEnd - sp.previewStart) {
      sp.previewStart = seg.startTime
      sp.previewEnd = seg.endTime
    }
  })
  return order.map((id) => byId.get(id)!)
}
