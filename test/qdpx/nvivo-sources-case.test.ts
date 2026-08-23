import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import { readQdpx } from '../../src/main/qdpx/reader'

// NVivo names the binary/text-sources folder "Sources" (capital S); Magnolia
// has always written and read lowercase "sources". A case-sensitive
// `zip.file('sources/...')` lookup against an NVivo archive silently returns
// null for every source, leaving transcript text blank after import even
// though the bytes are right there in the file — see GitHub issue #7.
const NVIVO_XML = `<?xml version="1.0" encoding="utf-8"?>
<Project origin="NVivo 14" xmlns="urn:QDA-XML:project:1.0" name="NVivo Export">
 <Sources>
  <TextSource plainTextPath="internal://ABC123.txt" guid="ABC123" name="Interview 1"/>
 </Sources>
</Project>`

const TRANSCRIPT_TEXT = 'Interviewer: Tell me about your experience.\nParticipant: It was great.'

async function buildQdpx(sourcesFolderName: string): Promise<string> {
  const zip = new JSZip()
  zip.file('project.qde', NVIVO_XML)
  zip.folder(sourcesFolderName)!.file('ABC123.txt', TRANSCRIPT_TEXT)
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const dir = await mkdtemp(join(tmpdir(), 'magnolia-nvivo-test-'))
  const filePath = join(dir, 'test.qdpx')
  await writeFile(filePath, buf)
  return filePath
}

describe('NVivo "Sources" folder casing', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('loads transcript text from an uppercase "Sources" folder (NVivo)', async () => {
    const filePath = await buildQdpx('Sources')
    tempDirs.push(join(filePath, '..'))
    const result = await readQdpx(filePath)
    expect(result.sourceContents['ABC123']).toBe(TRANSCRIPT_TEXT)
  })

  it('still loads transcript text from a lowercase "sources" folder (Magnolia / existing behaviour)', async () => {
    const filePath = await buildQdpx('sources')
    tempDirs.push(join(filePath, '..'))
    const result = await readQdpx(filePath)
    expect(result.sourceContents['ABC123']).toBe(TRANSCRIPT_TEXT)
  })
})
