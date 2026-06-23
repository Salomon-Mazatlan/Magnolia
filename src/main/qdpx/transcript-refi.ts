/**
 * Audio/Video transcript ⇄ REFI-QDA Transcript/SyncPoint interop layer.
 *
 * Magnolia stores a media transcript as plain text in `sources/<guid>.txt`
 * plus a `lineTimes` map (line index → seconds, kept in the
 * `magnolia-sources.json` side-table) that time-syncs each transcript
 * line to the media. That round-trips Magnolia↔Magnolia but is invisible
 * to other tools: the transcript text is an orphaned .txt the XML never
 * references, and the time-sync is in an app-specific JSON they drop.
 *
 * The QDA-XML 1.0 schema models exactly this (spec slides 10-11:
 * "Multimedia can be transcribed with text … synchronized by syncpoints"):
 *
 *   - <Transcript>  a child of <AudioSource>/<VideoSource>, carrying the
 *                   transcript (here by plainTextPath to the existing
 *                   sources/<guid>.txt) and a list of <SyncPoint>s.
 *   - <SyncPoint>   a (timeStamp in ms, position in characters) pair that
 *                   pins one transcript offset to one media time — the
 *                   standard form of Magnolia's per-line `lineTimes`.
 *
 * `buildTranscript` turns lineTimes into SyncPoints for export;
 * `reconstructLineTimes` does the inverse on import, so a transcript that
 * round-tripped through another tool comes back time-synced even though
 * the magnolia-sources.json side-table was dropped.
 */

export interface RefiSyncPoint {
  guid: string
  /** Media time in milliseconds. */
  timeStamp?: number
  /** Character offset into the transcript (codepoint offset, matching
   *  Magnolia's selection model). */
  position?: number
}

export interface RefiTranscript {
  guid: string
  plainTextPath: string
  syncPoints: RefiSyncPoint[]
}

/** Codepoint length (not UTF-16 code-unit length) — Magnolia indexes text
 *  offsets by codepoint, so SyncPoint positions are counted the same way. */
function cpLength(s: string): number {
  return [...s].length
}

/** Derive the Transcript's own guid from the source guid by flipping the
 *  first hex nibble — deterministic, reversible, and distinct from the
 *  source (audio/video sources never carry a PDF Representation, so this
 *  can't collide with representationGuidFor). */
function transcriptGuidFor(sourceGuid: string): string {
  if (!sourceGuid) return sourceGuid
  const n = parseInt(sourceGuid[0], 16)
  if (Number.isNaN(n)) return sourceGuid
  return (15 - n).toString(16) + sourceGuid.slice(1)
}

/** Derive a stable, schema-valid SyncPoint guid from the source guid and a
 *  line index: keep the source's first 24 chars (`XXXXXXXX-XXXX-XXXX-XXXX-`)
 *  and replace the 12-hex node with the zero-padded line index. Unique per
 *  line, distinct from the source and transcript guids, and stable across
 *  saves. */
function syncPointGuidFor(sourceGuid: string, lineIndex: number): string {
  const prefix = sourceGuid.slice(0, 24)
  const node = lineIndex.toString(16).padStart(12, '0').slice(-12).toUpperCase()
  return prefix + node
}

/** Codepoint offset of the start of each line (split on '\n'). */
function lineStartOffsets(text: string): number[] {
  const lines = text.split('\n')
  const starts: number[] = []
  let cp = 0
  for (const line of lines) {
    starts.push(cp)
    cp += cpLength(line) + 1 // +1 for the '\n' consumed by split
  }
  return starts
}

/**
 * Build a <Transcript> for an audio/video source from its transcript text
 * and lineTimes. Returns null when there's nothing to emit (no text and no
 * timings) so silent sources don't get an empty Transcript.
 */
export function buildTranscript(
  sourceGuid: string,
  text: string,
  lineTimes: Record<string, number> | undefined
): RefiTranscript | null {
  const hasText = !!text && text.trim() !== ''
  const timed = lineTimes && Object.keys(lineTimes).length > 0
  if (!hasText && !timed) return null

  const starts = lineStartOffsets(text || '')
  const syncPoints: RefiSyncPoint[] = []
  if (timed) {
    for (const [idxStr, secs] of Object.entries(lineTimes!)) {
      const i = parseInt(idxStr, 10)
      if (!Number.isFinite(i) || i < 0) continue
      if (typeof secs !== 'number' || !Number.isFinite(secs)) continue
      syncPoints.push({
        guid: syncPointGuidFor(sourceGuid, i),
        timeStamp: Math.round(secs * 1000),
        position: starts[i] ?? 0
      })
    }
    syncPoints.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }

  return {
    guid: transcriptGuidFor(sourceGuid),
    plainTextPath: `internal://${sourceGuid}.txt`,
    syncPoints
  }
}

/**
 * Inverse of buildTranscript: turn a parsed transcript's SyncPoints back
 * into a `lineTimes` map (line index → seconds) against the given
 * transcript text. Each SyncPoint's character `position` is resolved to
 * the line it falls on. Used on import when a file arrives without
 * Magnolia's lineTimes side-table.
 */
export function reconstructLineTimes(
  text: string,
  syncPoints: RefiSyncPoint[]
): Record<string, number> {
  if (!text || syncPoints.length === 0) return {}
  const starts = lineStartOffsets(text)
  const lineTimes: Record<string, number> = {}
  for (const sp of syncPoints) {
    if (sp.timeStamp == null) continue
    const pos = sp.position ?? 0
    // Find the line whose [start, nextStart) range contains pos.
    let line = 0
    for (let i = 0; i < starts.length; i++) {
      if (pos >= starts[i]) line = i
      else break
    }
    lineTimes[String(line)] = sp.timeStamp / 1000
  }
  return lineTimes
}
