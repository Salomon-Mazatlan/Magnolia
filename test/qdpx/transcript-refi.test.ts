import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi } from 'vitest'
import { validateXML } from 'xmllint-wasm'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

import { serializeProject } from '../../src/main/qdpx/xml-serializer'
import { deserializeProject } from '../../src/main/qdpx/xml-deserializer'
import { buildTranscript, reconstructLineTimes, reconstructTranscriptSelections } from '../../src/main/qdpx/transcript-refi'
import type { Project } from '../../src/renderer/models/types'

const PROJECT_XSD = readFileSync(join(__dirname, '../fixtures/Project.xsd'), 'utf8')

async function validate(xml: string): Promise<{ valid: boolean; errors: unknown[] }> {
  const result = await validateXML({
    xml: [{ fileName: 'project.qde', contents: xml }],
    schema: [PROJECT_XSD]
  })
  return { valid: result.valid, errors: result.errors }
}

const AUDIO = 'D1111111-1111-1111-1111-111111111111'
const VIDEO = 'E2222222-2222-2222-2222-222222222222'
const CODE = 'C0DEC0DE-0000-4000-8000-00000000C0DE'
const TEXT = 'Hello world\nSecond line\nThird'
const LINE_TIMES = { '0': 0, '1': 2.5, '2': 5 }
// "Second line" spans codepoints 12–23 (line 2), so a coding there crosses
// a line-start sync point (12) and ends mid-line (23, a new boundary point).
const AUDIO_SELECTIONS = [
  { guid: 'D1111111-1111-1111-1111-00000000C001', startPosition: 12, endPosition: 23, codings: [{ guid: 'D1111111-1111-1111-1111-00000000A001', codeGuid: CODE }] }
]

/** Attach a transcript transient (as the writer does) and return a project
 *  with an audio + video source. */
function projectWithTranscripts(): Project {
  const audio: any = { guid: AUDIO, name: 'Recording', sourceType: 'audio', formatData: { audioExt: 'm4a', lineTimes: LINE_TIMES }, selections: AUDIO_SELECTIONS }
  audio._refiTranscript = buildTranscript(AUDIO, TEXT, LINE_TIMES, AUDIO_SELECTIONS)
  const video: any = {
    guid: VIDEO,
    name: 'Clip',
    sourceType: 'video',
    formatData: { videoExt: 'mp4', lineTimes: LINE_TIMES },
    selections: [
      { guid: 'E2222222-2222-2222-2222-0000000000C1', startPosition: 0, endPosition: 0, timeRange: { startTime: 1, endTime: 2 }, codings: [] }
    ]
  }
  video._refiTranscript = buildTranscript(VIDEO, TEXT, LINE_TIMES)
  return {
    name: 'Media Project',
    origin: 'Magnolia test',
    users: [{ guid: '00000000-0000-0000-0000-000000000001', name: 'T' }],
    codes: [{ guid: CODE, name: 'theme', isCodable: true, children: [] }],
    sources: [audio, video],
    sets: [],
    notes: []
  }
}

describe('Audio/Video transcripts → REFI-QDA <Transcript>/<SyncPoint>', () => {
  it('buildTranscript turns lineTimes into SyncPoints at line offsets', () => {
    const t = buildTranscript(AUDIO, TEXT, LINE_TIMES)!
    expect(t).not.toBeNull()
    expect(t.guid).not.toBe(AUDIO) // distinct from source guid
    expect(t.syncPoints).toHaveLength(3)
    const byPos = [...t.syncPoints].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    expect(byPos.map((s) => s.position)).toEqual([0, 12, 24]) // line start offsets
    expect(byPos.map((s) => s.timeStamp)).toEqual([0, 2500, 5000]) // ms
    // SyncPoint guids are unique.
    expect(new Set(t.syncPoints.map((s) => s.guid)).size).toBe(3)
  })

  it('buildTranscript returns null for a silent, untimed source', () => {
    expect(buildTranscript(AUDIO, '', undefined)).toBeNull()
  })

  it('reconstructLineTimes is the inverse of buildTranscript', () => {
    const t = buildTranscript(AUDIO, TEXT, LINE_TIMES)!
    const rebuilt = reconstructLineTimes(TEXT, t.syncPoints)
    expect(rebuilt).toEqual(LINE_TIMES)
  })

  it('serializes audio+video transcripts that validate against Project.xsd', async () => {
    const xml = serializeProject(projectWithTranscripts())
    const { valid, errors } = await validate(xml)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('emits <Transcript> before <VideoSelection> (VideoSourceType order)', () => {
    const xml = serializeProject(projectWithTranscripts())
    expect(xml).toContain('<Transcript')
    expect(xml).toContain('<SyncPoint')
    expect(xml.indexOf('<Transcript')).toBeLessThan(xml.indexOf('<VideoSelection'))
  })

  it('round-trips a transcript (timings + codings) through serialize → deserialize → reconstruct', () => {
    const xml = serializeProject(projectWithTranscripts())
    const parsed = deserializeProject(xml) as any
    const audio = parsed.sources.find((s: any) => s.guid === AUDIO)
    expect(audio._refiTranscript).toBeDefined()
    // 3 line-start sync points + 1 coding-boundary point (end of the coding).
    expect(audio._refiTranscript.syncPoints).toHaveLength(4)
    expect(reconstructLineTimes(TEXT, audio._refiTranscript.syncPoints)).toEqual(LINE_TIMES)
    // The coding comes back at its exact character offsets with its CodeRef.
    const codings = reconstructTranscriptSelections(audio._refiTranscript)
    expect(codings).toHaveLength(1)
    expect(codings[0].startPosition).toBe(12)
    expect(codings[0].endPosition).toBe(23)
    expect(codings[0].codings[0].codeGuid).toBe(CODE)
  })

  it('emits a <TranscriptSelection> with a CodeRef for each audio coding', () => {
    const xml = serializeProject(projectWithTranscripts())
    expect(xml).toContain('<TranscriptSelection')
    expect(/<TranscriptSelection[^>]*fromSyncPoint=/.test(xml)).toBe(true)
    // SyncPoint must precede TranscriptSelection (TranscriptType order).
    expect(xml.indexOf('<SyncPoint')).toBeLessThan(xml.indexOf('<TranscriptSelection'))
  })

  it('gives every SyncPoint a timeStamp, incl. interpolated coding boundaries (Atlas rejects timeless points)', () => {
    const t = buildTranscript(AUDIO, TEXT, LINE_TIMES, AUDIO_SELECTIONS)!
    // 3 line starts (0,12,24) + 1 boundary (23). All must be timed.
    expect(t.syncPoints).toHaveLength(4)
    expect(t.syncPoints.every((sp) => typeof sp.timeStamp === 'number')).toBe(true)
    // Times are non-decreasing in position (Atlas needs monotonic sync).
    const byPos = [...t.syncPoints].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    for (let i = 1; i < byPos.length; i++) {
      expect(byPos[i].timeStamp!).toBeGreaterThanOrEqual(byPos[i - 1].timeStamp!)
    }
    // The boundary at 23 sits between line starts 12 (2500ms) and 24 (5000ms).
    const boundary = t.syncPoints.find((sp) => sp.position === 23)!
    expect(boundary.timeStamp!).toBeGreaterThan(2500)
    expect(boundary.timeStamp!).toBeLessThan(5000)
    // ...and the boundary point must NOT corrupt the per-line times.
    expect(reconstructLineTimes(TEXT, t.syncPoints)).toEqual(LINE_TIMES)
  })

  it('emits a TranscriptSelection for a video coding even when it carries a timeRange', () => {
    // A video coding is character-precise AND time-ranged: it must round-trip
    // as a <TranscriptSelection> (the transcript text coding) in addition to
    // its <VideoSelection> (the timeline coding), so the text coding survives
    // export to other tools.
    const t = buildTranscript(VIDEO, TEXT, LINE_TIMES, [
      { guid: 'V0000000-0000-4000-8000-000000000001', startPosition: 12, endPosition: 23, timeRange: { startTime: 2.5, endTime: 5 }, codings: [{ guid: 'X', codeGuid: CODE }] }
    ])!
    expect(t.selections).toHaveLength(1)
    expect(t.selections[0].guid).toBe('V0000000-0000-4000-8000-000000000001')
  })
})
