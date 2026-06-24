import { describe, it, expect } from 'vitest'
import { deserializeProject } from '../../src/main/qdpx/xml-deserializer'

// MAXQDA exports name sources WITHOUT file extensions and stores audio-only
// recordings inside a <VideoSource>. This mirrors a real "New project" export
// (MAXQDA Plus 2020, Release 20.4.2): a TextSource, two PictureSources and a
// VideoSource pointing at an .m4a. Magnolia must classify each source by its
// element kind / media extension, not by sniffing the (extension-less) name.
const MAXQDA_XML = `<?xml version="1.0" encoding="utf-8"?>
<Project origin="MAXQDA 2020 (Release 20.4.2)" xmlns="urn:QDA-XML:project:1.0" name="New project">
 <Sources>
  <TextSource plainTextPath="internal://A.txt" guid="A" name="RTF"/>
  <PictureSource path="internal://B.jpg" guid="B" name="Screenshot 2026-06-24 at 16.41.21"/>
  <PictureSource path="internal://C.jpg" guid="C" name="magnoliasolid"/>
  <TextSource plainTextPath="internal://D.txt" guid="D" name="Video-transcript"/>
  <VideoSource path="internal://E.m4a" guid="E" name="New Recording 11"/>
 </Sources>
</Project>`

describe('MAXQDA source-type classification', () => {
  const parsed: any = deserializeProject(MAXQDA_XML)
  const byName = (name: string) => parsed.sources.find((s: any) => s.name === name)

  it('classifies <PictureSource> as image regardless of the extension-less name', () => {
    expect(byName('Screenshot 2026-06-24 at 16.41.21').sourceType).toBe('image')
    expect(byName('magnoliasolid').sourceType).toBe('image')
  })

  it('reclassifies a <VideoSource> holding an .m4a as audio', () => {
    expect(byName('New Recording 11').sourceType).toBe('audio')
  })

  it('leaves a <VideoSource> holding a real video extension as video', () => {
    const xml = MAXQDA_XML.replace('internal://E.m4a', 'internal://E.mp4')
    const reparsed: any = deserializeProject(xml)
    expect(reparsed.sources.find((s: any) => s.name === 'New Recording 11').sourceType).toBe('video')
  })
})
