import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi } from 'vitest'
import { validateXML } from 'xmllint-wasm'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

import { serializeProject } from '../../src/main/qdpx/xml-serializer'
import type { Project } from '../../src/renderer/models/types'

const PROJECT_XSD = readFileSync(join(__dirname, '../fixtures/Project.xsd'), 'utf8')

async function validate(xml: string): Promise<{ valid: boolean; errors: unknown[] }> {
  const result = await validateXML({
    xml: [{ fileName: 'project.qde', contents: xml }],
    schema: [PROJECT_XSD]
  })
  return { valid: result.valid, errors: result.errors }
}

const PDF = 'A0000000-0000-4000-8000-0000000000DF'
const CODE = 'C0000000-0000-4000-8000-00000000C0DE'
const PAGE_HEIGHT = 842 // A4 points

/** A PDF source with one box/region coding on page 1 and one text coding. */
function pdfProject(): Project {
  const pdf: any = {
    guid: PDF,
    name: 'Doc.pdf',
    sourceType: 'pdf',
    formatData: { pdfPageSizes: [{ width: 0, height: 0 }, { width: 595, height: PAGE_HEIGHT }] },
    selections: [
      // Box coding: page 1, top-left rectangle x=130 y=64 w=333 h=279.
      { guid: 'B0000000-0000-4000-8000-000000000001', startPosition: 0, endPosition: 0, pdfRegion: { page: 1, x: 130, y: 64, width: 333, height: 279 }, codings: [{ guid: 'B0000000-0000-4000-8000-0000000000C1', codeGuid: CODE }] },
      // Text coding: real character range, no region.
      { guid: 'B0000000-0000-4000-8000-000000000002', startPosition: 10, endPosition: 40, codings: [{ guid: 'B0000000-0000-4000-8000-0000000000C2', codeGuid: CODE }] }
    ]
  }
  return {
    name: 'PDF Project',
    origin: 'Magnolia test',
    users: [{ guid: '00000000-0000-4000-8000-000000000001', name: 'T' }],
    codes: [{ guid: CODE, name: 'theme', isCodable: true, children: [] }],
    sources: [pdf],
    sets: [],
    notes: []
  }
}

describe('PDF box codings → REFI-QDA <PDFSelection>', () => {
  it('serializes a PDF with a box + text coding that validates against Project.xsd', async () => {
    const xml = serializeProject(pdfProject())
    const { valid, errors } = await validate(xml)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('emits the box coding as a <PDFSelection> (before <Representation>), flipped to bottom-left/0-based', () => {
    const xml = serializeProject(pdfProject())
    expect(xml).toContain('<PDFSelection')
    // PDFSelection must precede Representation (PDFSourceType order).
    expect(xml.indexOf('<PDFSelection')).toBeLessThan(xml.indexOf('<Representation'))

    const m = xml.match(/<PDFSelection\b[^>]*\/?>/)![0]
    const attr = (name: string): number => Number(m.match(new RegExp(`${name}="(-?\\d+)"`))![1])
    expect(attr('page')).toBe(0) // 1-based 1 → 0-based 0
    expect(attr('firstX')).toBe(130) // x unchanged
    expect(attr('secondX')).toBe(463) // x + width
    // Y flipped about the page height: firstY = H-(y+h), secondY = H-y.
    expect(attr('firstY')).toBe(PAGE_HEIGHT - (64 + 279)) // 499
    expect(attr('secondY')).toBe(PAGE_HEIGHT - 64) // 778
    expect(attr('firstY')).toBeLessThan(attr('secondY'))
  })

  it('keeps the text coding as a <PlainTextSelection> in the Representation, not a PDFSelection', () => {
    const xml = serializeProject(pdfProject())
    // The text coding's char offsets survive as a PlainTextSelection.
    expect(/<PlainTextSelection[^>]*startPosition="10"[^>]*endPosition="40"/.test(xml)).toBe(true)
    // Exactly one PDFSelection (the box), not two.
    expect((xml.match(/<PDFSelection\b/g) || []).length).toBe(1)
  })

  it('falls back to a top-left rectangle when no page height is available', () => {
    const p = pdfProject()
    ;(p.sources[0] as any).formatData = {} // no pdfPageSizes
    const xml = serializeProject(p)
    const m = xml.match(/<PDFSelection\b[^>]*\/?>/)![0]
    const attr = (name: string): number => Number(m.match(new RegExp(`${name}="(-?\\d+)"`))![1])
    expect(attr('firstY')).toBe(64) // top-left y, no flip
    expect(attr('secondY')).toBe(64 + 279)
  })
})
