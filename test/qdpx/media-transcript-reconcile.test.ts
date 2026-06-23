import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

import { reconcileMediaTranscripts, buildTranscript } from '../../src/main/qdpx/transcript-refi'
import { serializeProject } from '../../src/main/qdpx/xml-serializer'
import { deserializeProject } from '../../src/main/qdpx/xml-deserializer'

/** Rebuild the three reconciliation maps the reader derives from parsed
 *  sources (mirrors reader.ts). */
function readerMaps(sources: any[]) {
  const mediaPathByGuid = new Map<string, string>()
  const transcriptFileByGuid = new Map<string, string>()
  const textFileByGuid = new Map<string, string>()
  for (const s of sources) {
    if (s.sourceType === 'audio' || s.sourceType === 'video') {
      if (s.plainTextPath) mediaPathByGuid.set(s.guid, s.plainTextPath)
      const tp = (s._refiTranscript?.plainTextPath || '').match(/internal:\/\/(.+)/)
      if (tp) transcriptFileByGuid.set(s.guid, tp[1])
    } else if (!s.sourceType || s.sourceType === 'text') {
      const tp = (s.plainTextPath || '').match(/internal:\/\/(.+)/)
      if (tp) textFileByGuid.set(s.guid, tp[1])
    }
  }
  return { mediaPathByGuid, transcriptFileByGuid, textFileByGuid }
}

/** Mirrors Atlas's VideoFromAtlas.qdpx: a media VideoSource, a standalone
 *  transcript TextSource carrying the coding, and a second VideoSource whose
 *  <Transcript> re-references the same text — all for one coded video. */
function atlasVideoSources() {
  const MEDIA = 'relative:///EF19F4F8.m4a'
  const TXT = '08029678.txt'
  const sources = [
    { guid: 'VID1', sourceType: 'video', name: 'Video.mp4', selections: [] as unknown[] },
    { guid: 'TXT1', sourceType: 'text', name: 'Video-transcript', selections: [{ guid: 'SEL1', startPosition: 42, endPosition: 46, codings: [{ guid: 'C1', codeGuid: 'CODE' }] }] },
    { guid: 'VID2', sourceType: 'video', name: 'Video-transcript', selections: [] as unknown[] }
  ]
  const sourceContents: Record<string, string> = {
    TXT1: 'This is a video transcript.\nIt has a code here.',
    VID2: 'This is a video transcript.\nIt has a code here.'
  }
  const paths = {
    mediaPathByGuid: new Map([['VID1', MEDIA], ['VID2', MEDIA]]),
    transcriptFileByGuid: new Map([['VID2', TXT]]),
    textFileByGuid: new Map([['TXT1', TXT]])
  }
  return { sources, sourceContents, paths }
}

describe('reconcileMediaTranscripts', () => {
  it('folds the transcript inline into one video, keeping the coding char-precise', () => {
    const { sources, sourceContents, paths } = atlasVideoSources()
    const result = reconcileMediaTranscripts(sources, sourceContents, paths)

    // One document survives: the video, now carrying its transcript inline.
    expect(result).toHaveLength(1)
    const video: any = result[0]
    expect(video.guid).toBe('VID1')
    expect(video.sourceType).toBe('video')
    expect(sourceContents.VID1).toBe('This is a video transcript.\nIt has a code here.')
    // The coding keeps its exact character offsets (char-precise highlight).
    expect(video.selections).toHaveLength(1)
    expect(video.selections[0].startPosition).toBe(42)
    expect(video.selections[0].endPosition).toBe(46)
    expect(video.selections[0].codings[0].codeGuid).toBe('CODE')
    // The standalone transcript + duplicate video were folded away.
    expect(sourceContents.TXT1).toBeUndefined()
    expect(sourceContents.VID2).toBeUndefined()
  })

  it('derives a timeRange for a folded coding when the video has line times', () => {
    const sources = [
      { guid: 'V', sourceType: 'video', name: 'Clip.mp4', formatData: { lineTimes: { '0': 0, '1': 5 } }, selections: [] as any[] },
      { guid: 'T', sourceType: 'text', name: 'Clip-transcript', selections: [{ guid: 'S', startPosition: 30, endPosition: 34, codings: [] }] },
      { guid: 'V2', sourceType: 'video', name: 'Clip-transcript', selections: [] as any[] }
    ]
    // "Line one is here.\nLine two is here." → char 30 is on line 1.
    const sourceContents: Record<string, string> = { T: 'Line one is here.\nLine two is here.', V2: 'Line one is here.\nLine two is here.' }
    const result = reconcileMediaTranscripts(sources, sourceContents, {
      mediaPathByGuid: new Map([['V', 'p'], ['V2', 'p']]),
      transcriptFileByGuid: new Map([['V2', 'f']]),
      textFileByGuid: new Map([['T', 'f']])
    })
    const v: any = result[0]
    expect(v.selections[0].timeRange).toBeDefined()
    expect(v.selections[0].timeRange.startTime).toBe(5) // line 1's time
  })

  it('leaves a Magnolia-native file (one media source, inline transcript) untouched', () => {
    const sources = [
      { guid: 'V', sourceType: 'video', name: 'Clip.mp4', selections: [{ guid: 'S', startPosition: 0, endPosition: 5, codings: [] }] }
    ]
    const sourceContents = { V: 'hello transcript' }
    const paths = {
      mediaPathByGuid: new Map([['V', 'internal://V.mp4']]),
      transcriptFileByGuid: new Map([['V', 'V.txt']]), // its own inline transcript, no duplicate
      textFileByGuid: new Map<string, string>()
    }
    const result = reconcileMediaTranscripts(sources, sourceContents, paths)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(sources[0]) // unchanged
    expect(sourceContents.V).toBe('hello transcript')
  })

  it('full round-trip: a Magnolia video coding survives serialize → deserialize → reconcile', () => {
    const VIDEO = 'E2222222-2222-2222-2222-222222222222'
    const CODE = 'C0DEC0DE-0000-4000-8000-00000000C0DE'
    const TEXT = 'Hello world\nSecond line\nThird'
    const LINE_TIMES = { '0': 0, '1': 2.5, '2': 5 }
    const sel = {
      guid: 'B0000000-0000-4000-8000-000000000001',
      startPosition: 12, endPosition: 23,
      timeRange: { startTime: 2.5, endTime: 5 },
      codings: [{ guid: 'A0000000-0000-4000-8000-00000000000C', codeGuid: CODE }]
    }
    const video: any = {
      guid: VIDEO, name: 'Clip', sourceType: 'video',
      formatData: { videoExt: 'mp4', lineTimes: LINE_TIMES }, selections: [sel]
    }
    video._refiTranscript = buildTranscript(VIDEO, TEXT, LINE_TIMES, video.selections)
    const project: any = {
      name: 'P', origin: 'test',
      users: [{ guid: 'U0000000-0000-4000-8000-000000000001', name: 'T' }],
      codes: [{ guid: CODE, name: 'theme', isCodable: true, children: [] }],
      sources: [video], sets: [], notes: []
    }
    // Serialize (Atlas 3-source split) → deserialize.
    const parsed: any = deserializeProject(serializeProject(project))
    // The reader restores the media source's line times from the sidecar.
    const media = parsed.sources.find((s: any) => s.guid === VIDEO)
    media.formatData = { ...(media.formatData || {}), lineTimes: LINE_TIMES }
    // The reader loads each referenced text file's content; here both the
    // TextSource and the media-transcript source resolve to the transcript text.
    const sourceContents: Record<string, string> = {}
    for (const s of parsed.sources) {
      if ((s.selections?.length ?? 0) > 0 || s._refiTranscript) sourceContents[s.guid] = TEXT
    }
    const folded = reconcileMediaTranscripts(parsed.sources, sourceContents, readerMaps(parsed.sources))
    // Back to ONE source — the coding preserved char-precise, with its code.
    expect(folded).toHaveLength(1)
    const v: any = folded[0]
    expect(v.guid).toBe(VIDEO)
    expect(v.selections).toHaveLength(1)
    expect(v.selections[0].startPosition).toBe(12)
    expect(v.selections[0].endPosition).toBe(23)
    expect(v.selections[0].codings[0].codeGuid).toBe(CODE)
    // ...and a timeRange re-derived from the line times for the timeline.
    expect(v.selections[0].timeRange).toBeDefined()
  })

  it('is a no-op when no media source references a transcript', () => {
    const sources = [
      { guid: 'A', sourceType: 'text', name: 'Doc', selections: [] },
      { guid: 'B', sourceType: 'video', name: 'Clip', selections: [] }
    ]
    const sourceContents = { A: 'a', B: '' }
    const result = reconcileMediaTranscripts(sources, sourceContents, {
      mediaPathByGuid: new Map([['B', 'internal://B.mp4']]),
      transcriptFileByGuid: new Map(),
      textFileByGuid: new Map([['A', 'A.txt']])
    })
    expect(result).toHaveLength(2)
  })
})
