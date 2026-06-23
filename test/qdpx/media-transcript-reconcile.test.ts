import { describe, it, expect } from 'vitest'
import { reconcileMediaTranscripts } from '../../src/main/qdpx/transcript-refi'

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
  it('collapses Atlas\'s split video+transcript into one media document with the coding', () => {
    const { sources, sourceContents, paths } = atlasVideoSources()
    const result = reconcileMediaTranscripts(sources, sourceContents, paths)

    expect(result).toHaveLength(1)
    const v: any = result[0]
    expect(v.sourceType).toBe('video')
    expect(v.name).toBe('Video.mp4') // the non-transcript name wins
    expect(sourceContents[v.guid]).toBe('This is a video transcript.\nIt has a code here.')
    expect(v.selections).toHaveLength(1)
    // The char-offset coding [42,46] ("here", on line 1) is converted to the
    // video model: line-anchored, manuallyAnchored, with a timeRange so it
    // renders on the transcript.
    const sel = v.selections[0]
    expect(sel.startPosition).toBe(1) // content line index, not char offset
    expect(sel.endPosition).toBe(1)
    expect(sel.manuallyAnchored).toBe(true)
    expect(sel.timeRange).toBeDefined()
    expect(sel.codings[0].codeGuid).toBe('CODE')
    // The folded/duplicate sources' content is dropped from the map.
    expect(sourceContents.TXT1).toBeUndefined()
    expect(sourceContents.VID2).toBeUndefined()
  })

  it('leaves a Magnolia-native file (one media source, inline transcript) untouched', () => {
    const sources = [
      { guid: 'V', sourceType: 'video', name: 'Clip.mp4', selections: [{ guid: 'S', startPosition: 0, endPosition: 5, codings: [] }] }
    ]
    const sourceContents = { V: 'hello transcript' }
    const paths = {
      mediaPathByGuid: new Map([['V', 'internal://V.mp4']]),
      transcriptFileByGuid: new Map([['V', 'V.txt']]), // its own inline transcript
      textFileByGuid: new Map<string, string>()        // no standalone transcript
    }
    const result = reconcileMediaTranscripts(sources, sourceContents, paths)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(sources[0]) // unchanged
    expect(sourceContents.V).toBe('hello transcript')
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
