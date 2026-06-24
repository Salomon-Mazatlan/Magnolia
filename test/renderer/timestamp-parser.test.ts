import { describe, it, expect } from 'vitest'
import { parseSubtitleTranscript, parseNoScribeHtmlTranscript } from '../../src/renderer/utils/timestamp-parser'

// The actual noScribe 0.7 export (transcript.vtt): a `WEBVTT <title>` header,
// two NOTE metadata blocks, numeric cue identifiers, empty `<v >` voice tags,
// millisecond timings, and one malformed end timestamp (00:00:10.01).
const NOSCRIBE_VTT = `WEBVTT Mic_Check_Podcast

NOTE
Transcribed with noScribe vers. 0.7
Audio file: /Users/username/Desktop/Mic_Check_Podcast.wav
(Language: Multilingual (multilingual) | Speaker detection: none | Overlapping speech: False | Timestamps: False | Disfluencies: 0 | Mark pause: 0)


NOTE media: /Users/username/Desktop/Mic_Check_Podcast.wav

1
00:00:01.930 --> 00:00:03.310
<v >Das ist jetzt auch Klick-Klick-Klick.

2
00:00:03.470 --> 00:00:03.690
<v >Ja.

3
00:00:05.120 --> 00:00:06.270
<v >Ah, ja, Klick-Klick.

4
00:00:06.410 --> 00:00:10.01
<v >Das ist schön, so eine Art Feedback, dass ich weiß, wann, wie, was.

5
00:00:10.250 --> 00:00:10.490
<v >Super.

6
00:00:10.930 --> 00:00:11.230
<v >Toll.

7
00:00:11.370 --> 00:00:11.680
<v >Genau.

8
00:00:15.072 --> 00:00:17.312
<v >Ja, eine Leuchte wollte ich noch kaufen.
`

describe('parseSubtitleTranscript — WebVTT', () => {
  it('parses a noScribe WebVTT file into clean lines + per-line times', () => {
    const r = parseSubtitleTranscript(NOSCRIBE_VTT)!
    expect(r).not.toBeNull()
    const lines = r.content.split('\n')
    expect(lines).toHaveLength(8)
    // Header, NOTE blocks, cue numbers and <v > tags are gone — just the text.
    expect(lines[0]).toBe('Das ist jetzt auch Klick-Klick-Klick.')
    expect(lines[7]).toBe('Ja, eine Leuchte wollte ich noch kaufen.')
    expect(r.content).not.toContain('WEBVTT')
    expect(r.content).not.toContain('NOTE')
    expect(r.content).not.toContain('<v')
    expect(r.content).not.toContain('noScribe')
  })

  it('keeps millisecond precision in lineTimes', () => {
    const r = parseSubtitleTranscript(NOSCRIBE_VTT)!
    expect(r.lineTimes['0']).toBeCloseTo(1.93, 5)
    expect(r.lineTimes['7']).toBeCloseTo(15.072, 5)
    // One time per line, in order.
    expect(Object.keys(r.lineTimes)).toHaveLength(8)
  })

  it('starts a cue at its in-point regardless of a malformed end timestamp', () => {
    // Cue 4 ends at "00:00:10.01" (non-standard ms) but starts at 00:00:06.410.
    const r = parseSubtitleTranscript(NOSCRIBE_VTT)!
    expect(r.lineTimes['3']).toBeCloseTo(6.41, 5)
    expect(r.content.split('\n')[3]).toContain('eine Art Feedback')
  })

  it('handles a bare "WEBVTT" header and an empty cue identifier', () => {
    const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello there\n\n00:00:02.500 --> 00:00:04.000\nSecond line'
    const r = parseSubtitleTranscript(vtt)!
    expect(r.content).toBe('Hello there\nSecond line')
    expect(r.lineTimes).toEqual({ '0': 0, '1': 2.5 })
  })

  it('captures the spoken text of a voice tag with a named speaker', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Roger Bingham>I think so</v>'
    const r = parseSubtitleTranscript(vtt)!
    expect(r.content).toBe('I think so')
  })

  it('joins a multi-line cue payload into a single transcript line', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nfirst part\nsecond part'
    const r = parseSubtitleTranscript(vtt)!
    expect(r.content).toBe('first part second part')
    expect(Object.keys(r.lineTimes)).toHaveLength(1)
  })

  it('captures NOTE block text (provenance) without leaking it into the transcript', () => {
    const r = parseSubtitleTranscript(NOSCRIBE_VTT)!
    expect(r.notes).toHaveLength(2)
    // The leading "NOTE" keyword is stripped; the comment body is kept.
    expect(r.notes[0]).toContain('Transcribed with noScribe vers. 0.7')
    expect(r.notes[0]).toContain('Audio file: /Users/username/Desktop/Mic_Check_Podcast.wav')
    expect(r.notes[0]).not.toMatch(/^NOTE/)
    // An inline "NOTE media: …" keeps its text after the keyword.
    expect(r.notes[1]).toBe('media: /Users/username/Desktop/Mic_Check_Podcast.wav')
    // ...and none of it ends up in the transcript text.
    expect(r.content).not.toContain('Mic_Check_Podcast.wav')
  })

  it('returns an empty notes array when there are no NOTE blocks', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello'
    expect(parseSubtitleTranscript(vtt)!.notes).toEqual([])
  })
})

describe('parseSubtitleTranscript — SRT', () => {
  it('parses SRT (comma decimals, index lines) with fractional times', () => {
    const srt = '1\n00:00:01,500 --> 00:00:02,800\nFirst caption\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond caption'
    const r = parseSubtitleTranscript(srt)!
    expect(r.content).toBe('First caption\nSecond caption')
    expect(r.lineTimes['0']).toBeCloseTo(1.5, 5)
    expect(r.lineTimes['1']).toBeCloseTo(3.0, 5)
  })
})

describe('parseSubtitleTranscript — non-subtitle input', () => {
  it('returns null for plain text so the caller falls back', () => {
    expect(parseSubtitleTranscript('Just a normal transcript.\nWith two lines.')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseSubtitleTranscript('')).toBeNull()
  })

  it('returns null for noScribe HTML (handled by the HTML parser instead)', () => {
    expect(parseSubtitleTranscript(NOSCRIBE_HTML)).toBeNull()
  })
})

// The actual noScribe 0.7 HTML export (noscribe.html / New Recording 11.html):
// a qrichtext header, an audio_source meta tag, a gray provenance paragraph,
// and timed segment anchors `ts_<startMs>_<endMs>_<speaker>`.
const NOSCRIBE_HTML = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0//EN" "http://www.w3.org/TR/REC-html40/strict.dtd">
<html >
<head >
<meta charset="UTF-8" />
<meta name="qrichtext" content="1" />
<meta name="audio_source" content="/Users/caledavis/Downloads/New Recording 10.m4a" /></head>
<body style="font-family: 'Arial'" >
<div class="WordSection1" ><p style="font-weight: 600" >New Recording 10</p><p ><span style="color: #909090; font-size: 0.8em" >Transcribed with noScribe vers. 0.7<br />Audio file: /Users/caledavis/Downloads/New Recording 10.m4a<br />(Language: Auto (auto) | Speaker detection: auto | Overlapping speech: 1 | Timestamps: 1 | Disfluencies: 1 | Mark pause: 1)</span></p><p ></p><p ><a name="ts_690_2070_S00" >S00: <span style="color: #78909C" >[00:00:00]</span> Testing, one, two, three.</a></p></div></body>
</html>`

describe('parseNoScribeHtmlTranscript', () => {
  it('extracts timed segments, dropping the visible timestamp but keeping the speaker label', () => {
    const r = parseNoScribeHtmlTranscript(NOSCRIBE_HTML)!
    expect(r).not.toBeNull()
    expect(r.content).toBe('S00: Testing, one, two, three.')
    // Start time comes from the anchor name (690 ms) at full precision.
    expect(r.lineTimes['0']).toBeCloseTo(0.69, 5)
    // The redundant [HH:MM:SS] display and HTML markup are gone.
    expect(r.content).not.toContain('[00:00:00]')
    expect(r.content).not.toContain('<')
  })

  it('captures the gray provenance block as a note', () => {
    const r = parseNoScribeHtmlTranscript(NOSCRIBE_HTML)!
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]).toContain('Transcribed with noScribe vers. 0.7')
    expect(r.notes[0]).toContain('Audio file: /Users/caledavis/Downloads/New Recording 10.m4a')
    expect(r.notes[0]).toContain('Speaker detection: auto')
    // <br /> became line breaks; no markup leaks through.
    expect(r.notes[0]).not.toContain('<br')
  })

  it('handles multiple segments and speakers in order', () => {
    const html = `<html><body><div>
<p><a name="ts_500_1500_S00" >S00: <span>[00:00:00]</span> Hello there.</a></p>
<p><a name="ts_1600_2400_S01" >S01: <span>[00:00:01]</span> Hi back.</a></p>
<p><a name="ts_2500_3000_S00" >S00: <span>[00:00:02]</span> Great &amp; good.</a></p>
</div></body></html>`
    const r = parseNoScribeHtmlTranscript(html)!
    expect(r.content.split('\n')).toEqual(['S00: Hello there.', 'S01: Hi back.', 'S00: Great & good.'])
    expect(r.lineTimes).toEqual({ '0': 0.5, '1': 1.6, '2': 2.5 })
  })

  it('falls back to the audio_source meta when there is no gray provenance block', () => {
    const html = `<html><head><meta name="audio_source" content="/x/clip.m4a" /></head><body>
<p><a name="ts_0_1000_S00" >Hello</a></p></body></html>`
    const r = parseNoScribeHtmlTranscript(html)!
    expect(r.notes).toEqual(['Audio file: /x/clip.m4a'])
  })

  it('returns null for HTML without noScribe segment anchors', () => {
    expect(parseNoScribeHtmlTranscript('<html><body><p>Just a web page</p></body></html>')).toBeNull()
    expect(parseNoScribeHtmlTranscript('plain text')).toBeNull()
  })
})
