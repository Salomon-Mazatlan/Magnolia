import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi } from 'vitest'
import { validateXML } from 'xmllint-wasm'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

import { serializeProject } from '../../src/main/qdpx/xml-serializer'
import { deserializeProject } from '../../src/main/qdpx/xml-deserializer'
import { buildTranscript, reconstructLineTimes } from '../../src/main/qdpx/transcript-refi'
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
const TEXT = 'Hello world\nSecond line\nThird'
const LINE_TIMES = { '0': 0, '1': 2.5, '2': 5 }

/** Attach a transcript transient (as the writer does) and return a project
 *  with an audio + video source. */
function projectWithTranscripts(): Project {
  const audio: any = { guid: AUDIO, name: 'Recording', sourceType: 'audio', formatData: { audioExt: 'm4a', lineTimes: LINE_TIMES }, selections: [] }
  audio._refiTranscript = buildTranscript(AUDIO, TEXT, LINE_TIMES)
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
    codes: [],
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

  it('round-trips a transcript through serialize → deserialize → reconstruct', () => {
    const xml = serializeProject(projectWithTranscripts())
    const parsed = deserializeProject(xml) as any
    const audio = parsed.sources.find((s: any) => s.guid === AUDIO)
    expect(audio._refiTranscript).toBeDefined()
    expect(audio._refiTranscript.syncPoints).toHaveLength(3)
    const rebuilt = reconstructLineTimes(TEXT, audio._refiTranscript.syncPoints)
    expect(rebuilt).toEqual(LINE_TIMES)
  })
})
