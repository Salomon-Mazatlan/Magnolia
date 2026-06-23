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

import type { Coding } from '../../renderer/models/types'

export interface RefiSyncPoint {
  guid: string
  /** Media time in milliseconds. */
  timeStamp?: number
  /** Character offset into the transcript (codepoint offset, matching
   *  Magnolia's selection model). */
  position?: number
}

/** A coded span on a transcript: REFI-QDA <TranscriptSelection>, whose
 *  range is bounded by two <SyncPoint>s (their `position`s give the start
 *  and end character offsets). Carries its <Coding>s. */
export interface RefiTranscriptSelection {
  guid: string
  name?: string
  fromSyncPoint?: string
  toSyncPoint?: string
  creatingUser?: string
  creationDateTime?: string
  codings: Coding[]
}

export interface RefiTranscript {
  guid: string
  plainTextPath: string
  syncPoints: RefiSyncPoint[]
  selections: RefiTranscriptSelection[]
}

/** The slice of a transcript coding selection buildTranscript needs. */
export interface TranscriptCodingInput {
  guid: string
  name?: string
  startPosition: number
  endPosition: number
  codings: Coding[]
  creatingUser?: string
  creationDateTime?: string
  // Discriminators that mark a selection as NOT a plain transcript coding
  // (video time-ranges, PDF/image regions, survey cells) — excluded below.
  timeRange?: unknown
  pdfRegion?: unknown
  surveyCell?: unknown
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
 *  character position: keep the source's first 24 chars
 *  (`XXXXXXXX-XXXX-XXXX-XXXX-`) and replace the 12-hex node with the
 *  zero-padded position. Keying on position (not line index) means a
 *  line-start sync point and a coding-boundary sync point at the same
 *  offset share one guid — the dedup the builder relies on — while staying
 *  distinct from the source and transcript guids and stable across saves. */
function syncPointGuidFor(sourceGuid: string, position: number): string {
  const prefix = sourceGuid.slice(0, 24)
  const node = position.toString(16).padStart(12, '0').slice(-12).toUpperCase()
  return prefix + node
}

/** Interpolate a media time (ms) for an arbitrary character position from
 *  the known line-start (position, time) points. Atlas rejects a SyncPoint
 *  without a timeStamp ("Position is invalid"), so every point — including
 *  coding boundaries minted mid-line — needs one. Linear between the two
 *  bracketing line points; extrapolated past the last using the final
 *  segment's rate; falls back to the position itself (monotonic) when there
 *  are no timed points at all. Always non-decreasing in position. */
function interpolateTime(position: number, timed: Array<{ pos: number; time: number }>): number {
  if (timed.length === 0) return position
  let lo: { pos: number; time: number } | null = null
  let hi: { pos: number; time: number } | null = null
  for (const p of timed) {
    if (p.pos <= position) lo = p
    if (p.pos >= position && !hi) hi = p
  }
  if (lo && hi) {
    if (hi.pos === lo.pos) return lo.time
    return Math.round(lo.time + ((position - lo.pos) / (hi.pos - lo.pos)) * (hi.time - lo.time))
  }
  if (lo && timed.length >= 2) {
    const a = timed[timed.length - 2]
    const b = timed[timed.length - 1]
    const rate = (b.time - a.time) / Math.max(1, b.pos - a.pos)
    return Math.round(lo.time + (position - lo.pos) * rate)
  }
  if (lo) return lo.time
  return hi ? hi.time : position
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

/** True for a plain char-offset transcript coding (what we map to a
 *  <TranscriptSelection>) — excludes video time-ranges, PDF/image regions,
 *  and survey cells, which have their own representations. */
function isTranscriptCoding(sel: TranscriptCodingInput): boolean {
  return (
    Array.isArray(sel.codings) && sel.codings.length > 0 &&
    typeof sel.startPosition === 'number' && typeof sel.endPosition === 'number' &&
    sel.endPosition > sel.startPosition &&
    !sel.timeRange && !sel.pdfRegion && !sel.surveyCell
  )
}

/**
 * Build a <Transcript> for an audio/video source from its transcript text,
 * lineTimes, and any char-offset codings. SyncPoints come from lineTimes
 * (line-start → media time) plus a position-only point at each coding
 * boundary that isn't already a line start; each coding becomes a
 * <TranscriptSelection> bounded by its start/end SyncPoints. Returns null
 * when there's nothing to emit (no text, timings, or codings).
 */
export function buildTranscript(
  sourceGuid: string,
  text: string,
  lineTimes: Record<string, number> | undefined,
  selections?: TranscriptCodingInput[]
): RefiTranscript | null {
  const hasText = !!text && text.trim() !== ''
  const timed = lineTimes && Object.keys(lineTimes).length > 0
  const codings = (selections ?? []).filter(isTranscriptCoding)
  if (!hasText && !timed && codings.length === 0) return null

  const starts = lineStartOffsets(text || '')
  // Sync points keyed by character position so a line-start point and a
  // coding boundary at the same offset coalesce into one.
  const byPos = new Map<number, RefiSyncPoint>()
  const syncAt = (position: number, timeStamp?: number): RefiSyncPoint => {
    let sp = byPos.get(position)
    if (!sp) {
      sp = { guid: syncPointGuidFor(sourceGuid, position), position }
      byPos.set(position, sp)
    }
    if (timeStamp != null && sp.timeStamp == null) sp.timeStamp = timeStamp
    return sp
  }

  if (timed) {
    for (const [idxStr, secs] of Object.entries(lineTimes!)) {
      const i = parseInt(idxStr, 10)
      if (!Number.isFinite(i) || i < 0) continue
      if (typeof secs !== 'number' || !Number.isFinite(secs)) continue
      syncAt(starts[i] ?? 0, Math.round(secs * 1000))
    }
  }

  // The line-start (position, time) anchors used to time coding-boundary
  // sync points, so every emitted SyncPoint carries a valid timeStamp.
  const timedAnchors = [...byPos.values()]
    .filter((sp) => sp.timeStamp != null)
    .map((sp) => ({ pos: sp.position ?? 0, time: sp.timeStamp! }))
    .sort((a, b) => a.pos - b.pos)

  const transcriptSelections: RefiTranscriptSelection[] = codings.map((sel) => ({
    guid: sel.guid,
    name: sel.name,
    fromSyncPoint: syncAt(sel.startPosition, interpolateTime(sel.startPosition, timedAnchors)).guid,
    toSyncPoint: syncAt(sel.endPosition, interpolateTime(sel.endPosition, timedAnchors)).guid,
    creatingUser: sel.creatingUser,
    creationDateTime: sel.creationDateTime,
    codings: sel.codings
  }))

  const syncPoints = [...byPos.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  return {
    guid: transcriptGuidFor(sourceGuid),
    plainTextPath: `internal://${sourceGuid}.txt`,
    syncPoints,
    selections: transcriptSelections
  }
}

/**
 * Inverse of buildTranscript's coding pass: turn a parsed transcript's
 * <TranscriptSelection>s back into char-offset codings by resolving each
 * selection's from/to SyncPoint to its `position`. Returns the data the
 * reader needs to rebuild Magnolia PlainTextSelections.
 */
export function reconstructTranscriptSelections(
  transcript: RefiTranscript
): Array<{ guid: string; name?: string; startPosition: number; endPosition: number; creatingUser?: string; creationDateTime?: string; codings: Coding[] }> {
  const posByGuid = new Map<string, number>()
  for (const sp of transcript.syncPoints) {
    if (sp.position != null) posByGuid.set(sp.guid, sp.position)
  }
  const out: Array<{ guid: string; name?: string; startPosition: number; endPosition: number; creatingUser?: string; creationDateTime?: string; codings: Coding[] }> = []
  for (const ts of transcript.selections ?? []) {
    const a = ts.fromSyncPoint ? posByGuid.get(ts.fromSyncPoint) : undefined
    const b = ts.toSyncPoint ? posByGuid.get(ts.toSyncPoint) : undefined
    if (a == null || b == null) continue
    out.push({
      guid: ts.guid,
      name: ts.name,
      startPosition: Math.min(a, b),
      endPosition: Math.max(a, b),
      creatingUser: ts.creatingUser,
      creationDateTime: ts.creationDateTime,
      codings: ts.codings
    })
  }
  return out
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
  // Map a position back to a line ONLY when it's exactly a line start. Coding
  // boundaries now also carry timeStamps (Atlas requires it), so the old
  // "containing line" rule would let a mid-line boundary overwrite a real
  // line time. Line-start sync points are the authoritative per-line timing.
  const lineByStart = new Map<number, number>()
  starts.forEach((pos, i) => lineByStart.set(pos, i))
  const lineTimes: Record<string, number> = {}
  for (const sp of syncPoints) {
    if (sp.timeStamp == null || sp.position == null) continue
    const line = lineByStart.get(sp.position)
    if (line != null) lineTimes[String(line)] = sp.timeStamp / 1000
  }
  return lineTimes
}
