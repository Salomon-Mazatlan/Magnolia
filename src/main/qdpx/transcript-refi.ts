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

/** Derive a distinct guid for a transcript twin element by flipping the first
 *  hex nibble. A video coding is written BOTH as a <VideoSelection> (timeline)
 *  and a <TranscriptSelection> (transcript text) — REFI-QDA requires every
 *  element's guid to be unique, so the two can't share one guid (Atlas, and
 *  any conformant reader, collapses the duplicate and silently drops the
 *  transcript text coding on round-trip). Flipping the first nibble keeps the
 *  derivation deterministic and reversible (15-n is never n), so the reader
 *  can still recognise the transcript twin of a VideoSelection and merge them
 *  back into one selection. Used for both the selection guid and its inner
 *  Coding guid(s). */
export function transcriptTwinGuidFor(guid: string): string {
  if (!guid) return guid
  const n = parseInt(guid[0], 16)
  if (Number.isNaN(n)) return guid
  return (15 - n).toString(16).toUpperCase() + guid.slice(1)
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

/** True for a character-offset transcript coding (what we map to a
 *  <TranscriptSelection>). A video coding carries BOTH a character span and
 *  a time range, so it's emitted as a <TranscriptSelection> (the transcript
 *  text coding) AND a <VideoSelection> (the timeline coding) — a time range
 *  is therefore allowed here. Only PDF/image regions and survey cells, which
 *  have their own representations, are excluded. */
function isTranscriptCoding(sel: TranscriptCodingInput): boolean {
  return (
    Array.isArray(sel.codings) && sel.codings.length > 0 &&
    typeof sel.startPosition === 'number' && typeof sel.endPosition === 'number' &&
    sel.endPosition > sel.startPosition &&
    !sel.pdfRegion && !sel.surveyCell
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

  const transcriptSelections: RefiTranscriptSelection[] = codings.map((sel) => {
    // A video coding (one with a timeRange) is also written as a twin
    // <VideoSelection> that keeps sel.guid, so this <TranscriptSelection>
    // must take a distinct, deterministically-derived guid or a conformant
    // reader collapses the duplicate and drops the text coding. An audio
    // coding has no twin, so it keeps its own guid (transcriptTwinGuidFor is
    // an involution — deriving it here would oscillate the guid across saves).
    const hasTwin = (sel as any).timeRange != null
    return {
      guid: hasTwin ? transcriptTwinGuidFor(sel.guid) : sel.guid,
      name: sel.name,
      fromSyncPoint: syncAt(sel.startPosition, interpolateTime(sel.startPosition, timedAnchors)).guid,
      toSyncPoint: syncAt(sel.endPosition, interpolateTime(sel.endPosition, timedAnchors)).guid,
      creatingUser: sel.creatingUser,
      creationDateTime: sel.creationDateTime,
      codings: hasTwin
        ? sel.codings.map((c) => ({ ...c, guid: transcriptTwinGuidFor(c.guid) }))
        : sel.codings
    }
  })

  const syncPoints = [...byPos.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  return {
    guid: transcriptGuidFor(sourceGuid),
    plainTextPath: `internal://${sourceGuid}.txt`,
    syncPoints,
    selections: transcriptSelections
  }
}

/** Codepoint offset of the start of each line, plus a trailing total — the
 *  i-th line spans [offsets[i], offsets[i+1]). Used to map character ranges
 *  to/from transcript lines. */
export function lineStartOffsetsWithEnd(text: string): number[] {
  const lines = (text || '').split('\n')
  const out: number[] = []
  let cp = 0
  for (const line of lines) {
    out.push(cp)
    cp += [...line].length + 1
  }
  out.push(cp)
  return out
}

/** The content line a character offset falls on. */
export function lineForChar(text: string, cp: number): number {
  const offsets = lineStartOffsetsWithEnd(text)
  let line = 0
  for (let i = 0; i < offsets.length - 1; i++) {
    if (cp >= offsets[i]) line = i
    else break
  }
  return line
}

/**
 * Derive a video time range (seconds) for a coded CHARACTER span from the
 * transcript's per-line times. The span's first/last lines give the in/out:
 * start = that start-line's time, end = the line after the end-line's time
 * (so the range covers the spoken lines). Returns undefined when there are no
 * line times — the coding still renders char-precise; it just isn't on the
 * timeline. This is the "best of both worlds" coupling: char-precise text,
 * line-granular time.
 */
export function deriveLineTimeRange(
  text: string,
  startCp: number,
  endCp: number,
  lineTimes: Record<string, number> | undefined
): { startTime: number; endTime: number } | undefined {
  if (!lineTimes || Object.keys(lineTimes).length === 0) return undefined
  const startLine = lineForChar(text, startCp)
  const endLine = lineForChar(text, Math.max(endCp - 1, startCp))
  const at = (line: number): number | undefined => {
    const v = lineTimes[String(line)]
    return typeof v === 'number' ? v : undefined
  }
  const startTime = at(startLine)
  if (startTime == null) return undefined
  // End time: the next line's start if known, else the end-line's own time.
  const endTime = at(endLine + 1) ?? at(endLine) ?? startTime
  return { startTime, endTime: Math.max(endTime, startTime) }
}

/** Per-source path lookups the media-transcript reconciliation needs,
 *  captured by the reader before paths are cleared / _refiTranscript is
 *  deleted. Keys are source guids. */
export interface MediaTranscriptPaths {
  /** media source guid → its raw media `path` (e.g. `relative:///x.m4a`). */
  mediaPathByGuid: Map<string, string>
  /** media source guid → the internal text file its <Transcript> references. */
  transcriptFileByGuid: Map<string, string>
  /** text source guid → its own internal text file. */
  textFileByGuid: Map<string, string>
}

interface ReconcilableSource {
  guid: string
  sourceType?: string
  name?: string
  formatData?: any
  selections?: any[]
}

/**
 * Collapse the multiple sources another tool (Atlas) emits for ONE coded
 * video/audio into a single media document with an inline transcript.
 *
 * Atlas exports a coded video as up to three sources: the media
 * <VideoSource>/<AudioSource> (e.g. "Video.mp4"), a standalone transcript
 * <TextSource> ("Video-transcript") that carries the CHARACTER-precise
 * codings, and a SECOND media source whose <Transcript> child re-references
 * the same transcript text. We fold that into one document: the real media
 * source gets the transcript text and the character-precise codings; the
 * standalone transcript and the duplicate media source are dropped.
 *
 * Codings keep their character offsets (the text highlight is char-precise)
 * and gain a derived `timeRange` from the transcript's line times when known
 * (for the timeline) — the unified char-precise + line-timed model. A
 * Magnolia-authored file (one media source, inline <Transcript>, no
 * standalone transcript) is left untouched.
 */
export function reconcileMediaTranscripts<T extends ReconcilableSource>(
  sources: T[],
  sourceContents: Record<string, string>,
  paths: MediaTranscriptPaths
): T[] {
  const mediaPathByGuid = paths.mediaPathByGuid ?? new Map<string, string>()
  const transcriptFileByGuid = paths.transcriptFileByGuid ?? new Map<string, string>()
  const textFileByGuid = paths.textFileByGuid ?? new Map<string, string>()
  const transcriptTextFiles = new Set(transcriptFileByGuid.values())
  if (transcriptTextFiles.size === 0) return sources

  // 1. Gather each transcript file's text + codings from the standalone
  //    <TextSource> that carries them, and mark those sources for removal.
  const removed = new Set<string>()
  const codingsByFile = new Map<string, any[]>()
  const textByFile = new Map<string, string>()
  for (const s of sources) {
    if (s.sourceType && s.sourceType !== 'text') continue
    const file = textFileByGuid.get(s.guid)
    if (!file || !transcriptTextFiles.has(file)) continue
    codingsByFile.set(file, [...(codingsByFile.get(file) ?? []), ...(s.selections ?? [])])
    if (sourceContents[s.guid]) textByFile.set(file, sourceContents[s.guid])
    removed.add(s.guid)
  }

  // 2. Group media sources by media path; fold the transcript into one
  //    canonical media document per group and drop the duplicates.
  const byMedia = new Map<string, T[]>()
  for (const s of sources) {
    if (s.sourceType !== 'audio' && s.sourceType !== 'video') continue
    if (removed.has(s.guid)) continue
    const path = mediaPathByGuid.get(s.guid)
    if (!path) continue
    byMedia.set(path, [...(byMedia.get(path) ?? []), s])
  }
  for (const group of byMedia.values()) {
    const file = group.map((s) => transcriptFileByGuid.get(s.guid)).find(Boolean)
    if (!file) continue // no transcript linked to this media → leave as-is
    const canonical = group.find((s) => !/transcript/i.test(s.name ?? '')) ?? group[0]
    const text = textByFile.get(file)
    if (text != null) sourceContents[canonical.guid] = text
    const lineTimes = (canonical.formatData?.lineTimes ?? undefined) as Record<string, number> | undefined
    const folded = (codingsByFile.get(file) ?? []).map((sel) => {
      // Keep the char offsets (char-precise highlight); add a derived time
      // range so the coding also appears on the video timeline when timed.
      const tr = text != null
        ? deriveLineTimeRange(text, sel.startPosition ?? 0, sel.endPosition ?? 0, lineTimes)
        : undefined
      return tr ? { ...sel, timeRange: tr } : sel
    })
    if (folded.length > 0) canonical.selections = [...(canonical.selections ?? []), ...folded]
    for (const s of group) if (s !== canonical) removed.add(s.guid)
  }

  if (removed.size === 0) return sources
  for (const g of removed) delete sourceContents[g]
  return sources.filter((s) => !removed.has(s.guid))
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
