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

  it('splits a coded audio transcript into Atlas\'s layout (media + coded TextSource + SyncPoints)', () => {
    const xml = serializeProject(projectWithTranscripts())
    const parsed = deserializeProject(xml) as any
    // The media source carries NO inline transcript and no transcript codings.
    const media = parsed.sources.find((s: any) => s.guid === AUDIO)
    expect(media).toBeDefined()
    expect(media._refiTranscript).toBeUndefined()
    // A TextSource carries the coding as a <PlainTextSelection> at its exact
    // char offsets — the anchor Atlas keeps the code on.
    const textSrc = parsed.sources.find(
      (s: any) => s.guid !== AUDIO && (s.selections?.length ?? 0) > 0 && (s.plainTextPath ?? '').includes(`${AUDIO}.txt`)
    )
    expect(textSrc).toBeDefined()
    expect(textSrc.selections[0].startPosition).toBe(12)
    expect(textSrc.selections[0].endPosition).toBe(23)
    expect(textSrc.selections[0].codings[0].codeGuid).toBe(CODE)
    // A media-transcript source carries the SyncPoints referencing that text.
    const tsrc = parsed.sources.find((s: any) => (s._refiTranscript?.plainTextPath ?? '').includes(`${AUDIO}.txt`))
    expect(tsrc).toBeDefined()
    expect(reconstructLineTimes(TEXT, tsrc._refiTranscript.syncPoints)).toEqual(LINE_TIMES)
  })

  it('codes the transcript as a <PlainTextSelection> on a <TextSource>, NOT a <TranscriptSelection> (Atlas honours only the former)', () => {
    const xml = serializeProject(projectWithTranscripts())
    expect(xml).not.toContain('<TranscriptSelection')
    // The audio coding's code rides on a PlainTextSelection's CodeRef.
    expect(/<PlainTextSelection[\s\S]*?<CodeRef targetGUID="C0DEC0DE-0000-4000-8000-00000000C0DE"/.test(xml)).toBe(true)
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

  it('emits a TranscriptSelection (carrying the code) for a video coding with a timeRange', () => {
    // A video coding is character-precise AND time-ranged. It round-trips as a
    // single <TranscriptSelection> that carries the code — NOT also a twin
    // <VideoSelection>. The transcript selection keeps the coding's own guid.
    const t = buildTranscript(VIDEO, TEXT, LINE_TIMES, [
      { guid: 'B0000000-0000-4000-8000-000000000001', startPosition: 12, endPosition: 23, timeRange: { startTime: 2.5, endTime: 5 }, codings: [{ guid: 'A0000000-0000-4000-8000-00000000000C', codeGuid: CODE }] }
    ])!
    expect(t.selections).toHaveLength(1)
    expect(t.selections[0].guid).toBe('B0000000-0000-4000-8000-000000000001')
    expect(t.selections[0].codings[0].codeGuid).toBe(CODE)
  })

  it('an AUDIO coding keeps its own guid', () => {
    const t = buildTranscript(AUDIO, TEXT, LINE_TIMES, AUDIO_SELECTIONS)!
    const sel = t.selections.find((s) => s.guid === AUDIO_SELECTIONS[0].guid)
    expect(sel).toBeDefined()
  })

  it('serializes a video transcript coding as Atlas\'s 3-source split (no TranscriptSelection, no VideoSelection)', () => {
    // Emitting the coding inside the media source's <Transcript> (as a
    // <TranscriptSelection>) makes Atlas drop the code. Atlas only honours a
    // coding on a <PlainTextSelection> of a real <TextSource>, so we mirror
    // its three-source layout: empty media source, coded TextSource, and a
    // media-transcript source with the SyncPoints.
    const video: any = {
      guid: VIDEO, name: 'Clip', sourceType: 'video',
      formatData: { videoExt: 'mp4', lineTimes: LINE_TIMES },
      selections: [
        { guid: 'B0000000-0000-4000-8000-000000000001', startPosition: 12, endPosition: 23, timeRange: { startTime: 2.5, endTime: 5 }, codings: [{ guid: 'A0000000-0000-4000-8000-00000000000C', codeGuid: CODE }] }
      ]
    }
    video._refiTranscript = buildTranscript(VIDEO, TEXT, LINE_TIMES, video.selections)
    const project: Project = {
      name: 'P', origin: 'test',
      users: [{ guid: '00000000-0000-0000-0000-000000000001', name: 'T' }],
      codes: [{ guid: CODE, name: 'theme', isCodable: true, children: [] }],
      sources: [video], sets: [], notes: []
    }
    const xml = serializeProject(project)
    expect(xml).not.toContain('<TranscriptSelection')
    expect(xml).not.toContain('<VideoSelection')
    // The code rides on a <PlainTextSelection> in a <TextSource>.
    expect(/<PlainTextSelection[\s\S]*?<CodeRef targetGUID="C0DEC0DE-0000-4000-8000-00000000C0DE"/.test(xml)).toBe(true)
    // Both the TextSource and the media-transcript source reference the SAME
    // transcript text path, so Atlas (and our reader) link them.
    const textRefs = [...xml.matchAll(/plainTextPath="internal:\/\/([^"]+)"/g)].map((m) => m[1])
    expect(textRefs).toContain(`${VIDEO}.txt`)
    expect(textRefs.filter((r) => r === `${VIDEO}.txt`).length).toBe(2)
    // Every guid in the document is unique.
    const allGuids = [...xml.matchAll(/\bguid="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(allGuids).size).toBe(allGuids.length)
  })

  it('serializes an uncoded video transcript inline (single source, no split)', () => {
    const video: any = {
      guid: VIDEO, name: 'Clip', sourceType: 'video',
      formatData: { videoExt: 'mp4', lineTimes: LINE_TIMES },
      selections: []
    }
    video._refiTranscript = buildTranscript(VIDEO, TEXT, LINE_TIMES, [])
    const project: Project = {
      name: 'P', origin: 'test',
      users: [{ guid: '00000000-0000-0000-0000-000000000001', name: 'T' }],
      codes: [], sources: [video], sets: [], notes: []
    }
    const xml = serializeProject(project)
    // One VideoSource with an inline Transcript; no extra TextSource.
    expect((xml.match(/<VideoSource/g) ?? []).length).toBe(1)
    expect(xml).not.toContain('<TextSource')
    expect(xml).toContain('<Transcript')
  })

  it('STILL emits a <VideoSelection> for a pure timeline coding (no transcript-text anchor)', () => {
    // A coding that carries a timeRange but no character span isn't a
    // transcript-text coding, so it remains a <VideoSelection>.
    const video: any = {
      guid: VIDEO, name: 'Clip', sourceType: 'video',
      formatData: { videoExt: 'mp4', lineTimes: LINE_TIMES },
      selections: [
        { guid: 'D0000000-0000-4000-8000-000000000002', startPosition: 0, endPosition: 0, timeRange: { startTime: 1, endTime: 2 }, codings: [{ guid: 'E0000000-0000-4000-8000-00000000000E', codeGuid: CODE }] }
      ]
    }
    video._refiTranscript = buildTranscript(VIDEO, TEXT, LINE_TIMES, video.selections)
    const project: Project = {
      name: 'P', origin: 'test',
      users: [{ guid: '00000000-0000-0000-0000-000000000001', name: 'T' }],
      codes: [{ guid: CODE, name: 'theme', isCodable: true, children: [] }],
      sources: [video], sets: [], notes: []
    }
    const xml = serializeProject(project)
    expect(xml).toContain('<VideoSelection')
    expect(/<VideoSelection[^>]*guid="D0000000-0000-4000-8000-000000000002"/.test(xml)).toBe(true)
  })
})
