import { describe, it, expect } from 'vitest'
import { parseNoScribeHtmlTranscript, parseSubtitleTranscript } from '../../src/renderer/utils/timestamp-parser'
import { detectSpeakers } from '../../src/renderer/utils/transcript-speakers'

const NS = (segs: { s: number; e: number; spk: string; text: string }[]) =>
  `<html><body><div>${segs
    .map((g) => `<p><a name="ts_${g.s}_${g.e}_${g.spk}" >${g.spk}: <span>[00:00:00]</span> ${g.text}</a></p>`)
    .join('')}</div></body></html>`

describe('parseNoScribeHtmlTranscript — segments', () => {
  it('returns a segment per line with speaker + start/end times', () => {
    const r = parseNoScribeHtmlTranscript(NS([
      { s: 500, e: 1500, spk: 'S00', text: 'Hello.' },
      { s: 1600, e: 4000, spk: 'S01', text: 'Hi there.' }
    ]))!
    expect(r.segments).toHaveLength(2)
    expect(r.segments[0]).toEqual({ speaker: 'S00', startTime: 0.5, endTime: 1.5 })
    expect(r.segments[1]).toEqual({ speaker: 'S01', startTime: 1.6, endTime: 4.0 })
  })
})

describe('parseSubtitleTranscript — segments + WebVTT speakers', () => {
  it('captures the <v Speaker> name and the cue end time', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n<v Alice>Hello</v>\n\n00:00:03.000 --> 00:00:05.000\n<v Bob>Hi</v>'
    const r = parseSubtitleTranscript(vtt)!
    expect(r.segments).toEqual([
      { speaker: 'Alice', startTime: 1.0, endTime: 2.5 },
      { speaker: 'Bob', startTime: 3.0, endTime: 5.0 }
    ])
  })

  it('leaves speaker null when there is no <v> tag', () => {
    const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nNo speaker here'
    expect(parseSubtitleTranscript(vtt)!.segments[0].speaker).toBeNull()
  })
})

describe('detectSpeakers', () => {
  it('groups speakers in first-appearance order with codepoint ranges for each line', () => {
    const parsed = parseNoScribeHtmlTranscript(NS([
      { s: 0, e: 1000, spk: 'S00', text: 'Hello.' },       // line 0
      { s: 1000, e: 2000, spk: 'S01', text: 'Hi.' },        // line 1
      { s: 2000, e: 5000, spk: 'S00', text: 'Back again.' } // line 2
    ]))!
    const speakers = detectSpeakers(parsed)
    expect(speakers.map((s) => s.id)).toEqual(['S00', 'S01'])

    const s00 = speakers[0]
    expect(s00.segmentCount).toBe(2)
    // Two ranges (its two lines). The content is "S00: Hello.\nS01: Hi.\nS00: Back again."
    const lines = parsed.content.split('\n')
    expect(s00.ranges[0]).toEqual({ startChar: 0, endChar: [...lines[0]].length })
    // Line 2 starts after lines 0 and 1 plus their two newlines.
    const line2Start = [...lines[0]].length + 1 + [...lines[1]].length + 1
    expect(s00.ranges[1]).toEqual({ startChar: line2Start, endChar: line2Start + [...lines[2]].length })
  })

  it('previews the speaker\'s LONGEST segment', () => {
    const parsed = parseNoScribeHtmlTranscript(NS([
      { s: 0, e: 1000, spk: 'S00', text: 'Short.' },        // 1.0s
      { s: 2000, e: 9000, spk: 'S00', text: 'Much longer.' } // 7.0s  ← longest
    ]))!
    const [s00] = detectSpeakers(parsed)
    expect(s00.previewStart).toBe(2.0)
    expect(s00.previewEnd).toBe(9.0)
  })

  it('returns an empty list when no speakers are identified', () => {
    const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nNo speakers'
    expect(detectSpeakers(parseSubtitleTranscript(vtt)!)).toEqual([])
  })
})
