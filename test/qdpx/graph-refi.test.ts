import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi } from 'vitest'
import { validateXML } from 'xmllint-wasm'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

import { serializeProject } from '../../src/main/qdpx/xml-serializer'
import { mapToGraph, collectGraphs, graphToMap } from '../../src/main/qdpx/graph-refi'
import type { Project, SavedAnalysis } from '../../src/renderer/models/types'

const PROJECT_XSD = readFileSync(join(__dirname, '../fixtures/Project.xsd'), 'utf8')

async function validate(xml: string): Promise<{ valid: boolean; errors: unknown[] }> {
  const result = await validateXML({
    xml: [{ fileName: 'project.qde', contents: xml }],
    schema: [PROJECT_XSD]
  })
  return { valid: result.valid, errors: result.errors }
}

const DOC_GUID = 'D0CD0CD0-0000-4000-8000-00000000DD01'
const CODE_GUID = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
const ELDOC = 'E1111111-1111-4111-8111-111111111111'
const ELCODE = 'E2222222-2222-4222-8222-222222222222'
const FT1 = 'F1111111-1111-4111-8111-111111111111'
const CONN1 = 'C1111111-1111-4111-8111-111111111111'

/** Mirrors the user's frommag.qdpx: a document node and a code node, a
 *  free-text box, and a directed connection document → code. */
function mapAnalysis(): SavedAnalysis {
  return {
    guid: 'A1111111-1111-4111-8111-111111111111',
    toolType: 'relationship-map',
    name: 'RelationshipMap',
    createdDateTime: '2024-01-01T00:00:00Z',
    config: {
      pan: { x: 0, y: 0 },
      elements: [
        { id: ELDOC, kind: 'document', label: 'memohere.txt', entityGuid: DOC_GUID, x: 140, y: 188, width: 160, height: 40 },
        { id: ELCODE, kind: 'code', label: 'code', entityGuid: CODE_GUID, codeColor: '#e05050', x: 334, y: 336, width: 160, height: 28 }
      ],
      freeTexts: [
        { id: FT1, kind: 'freetext', x: 328, y: 136, width: 199, height: 83, content: '# Free text' }
      ],
      connections: [
        { id: CONN1, fromId: ELDOC, toId: ELCODE, arrowFrom: false, arrowTo: true, label: 'With a note' }
      ]
    }
  }
}

function projectWithMap(): Project {
  return {
    name: 'Graph Project',
    origin: 'Magnolia test',
    users: [{ guid: '00000000-0000-4000-8000-000000000001', name: 'T' }],
    codes: [{ guid: CODE_GUID, name: 'code', isCodable: true, children: [] }],
    sources: [{ guid: DOC_GUID, name: 'memohere.txt', sourceType: 'text', plainTextContent: 'hi', selections: [] }],
    sets: [],
    notes: [],
    savedAnalyses: [mapAnalysis()]
  }
}

describe('Relationship Map → REFI-QDA <Graphs> + <Links> (Atlas interop)', () => {
  it('gives every vertex a representedGUID (free-text backed by a Note)', () => {
    const { graphs, notes } = mapToGraph(mapAnalysis())
    const vs = graphs[0].vertices
    expect(vs).toHaveLength(3)
    expect(vs.every((v) => !!v.representedGuid)).toBe(true)
    // The free-text box is backed by a synthetic Note carrying its text.
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toBe('# Free text')
    const ftVertex = vs.find((v) => v.guid === FT1)!
    expect(ftVertex.shape).toBe('Note')
    expect(ftVertex.representedGuid).toBe(notes[0].guid)
  })

  it('emits a <Link> for the connection and points the edge at it', () => {
    const { graphs, links } = mapToGraph(mapAnalysis())
    expect(links).toHaveLength(1)
    // Link relates the ENTITIES (origin = document, target = code).
    expect(links[0].originGuid).toBe(DOC_GUID)
    expect(links[0].targetGuid).toBe(CODE_GUID)
    const edge = graphs[0].edges[0]
    // Edge wires the VERTICES and represents the Link.
    expect(edge.sourceVertex).toBe(ELDOC)
    expect(edge.targetVertex).toBe(ELCODE)
    expect(edge.representedGuid).toBe(links[0].guid)
    expect(edge.guid).not.toBe(links[0].guid) // distinct guids
  })

  it('serializes a map (Notes + Links + Graphs) that validates against Project.xsd', async () => {
    const xml = serializeProject(projectWithMap())
    const { valid, errors } = await validate(xml)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('produces the Atlas-shaped structure: every Vertex/Edge has representedGUID, plus a <Link> and a free-text <Note>', () => {
    const xml = serializeProject(projectWithMap())
    expect(xml).toContain('<Links>')
    expect(xml).toContain('<Link ')
    expect(xml).toContain('<Edge')
    expect(/<Edge[^>]*representedGUID=/.test(xml)).toBe(true)
    // All three vertices carry a representedGUID (none would be dropped by Atlas).
    const vertexTags = xml.match(/<Vertex[^>]*>/g) || []
    expect(vertexTags).toHaveLength(3)
    expect(vertexTags.every((v) => /representedGUID=/.test(v))).toBe(true)
    // The free-text box round-trips as an inline Note.
    expect(xml).toContain('# Free text')
  })

  it('ignores non-map analyses', () => {
    const bundle = collectGraphs([
      mapAnalysis(),
      { guid: 'B2222222-2222-4222-8222-222222222222', toolType: 'code-frequencies', name: 'Freqs', createdDateTime: '2024-01-01T00:00:00Z', config: {} }
    ])
    expect(bundle.graphs).toHaveLength(1)
  })

  it('graphToMap (no context) falls back to free-text boxes + connections', () => {
    const { graphs } = mapToGraph(mapAnalysis())
    const analysis = graphToMap(graphs[0])
    expect(analysis.toolType).toBe('relationship-map')
    expect(analysis.config.freeTexts).toHaveLength(3)
    expect(analysis.config.connections).toHaveLength(1)
    const conn = analysis.config.connections[0]
    expect(conn.fromId).toBe(ELDOC)
    expect(conn.toId).toBe(ELCODE)
    expect(conn.arrowTo).toBe(true)
  })

  it('graphToMap resolves vertices to entities and recovers the edge label from the <Link> (Atlas import)', () => {
    // Mirror an Atlas-authored graph: vertices bound to a document + two
    // codes, an edge whose label lives on the <Link> it represents.
    const V_DOC = '00C89D15-E069-4CEB-8948-9F3FB5A0CD4B'
    const V_IMG = 'A5B41962-05BF-4362-BBC4-8EE6D5321FD8'
    const V_ANO = 'B13D707F-019E-4D1B-857C-C8B670029955'
    const LINK = '9FD0FA13-196E-4A0C-9D8C-CC779CA24766'
    const graph = {
      guid: 'G0000000-0000-4000-8000-000000000001',
      name: 'Relationship Map',
      vertices: [
        { guid: V_DOC, representedGuid: DOC_GUID, name: 'magnoliasolid.png', firstX: 231, firstY: 97, secondX: 391, secondY: 194, shape: 'Rectangle' },
        { guid: V_IMG, representedGuid: '2A08BDDF-4C35-4250-BF77-7DE37B50C930', name: 'image', firstX: 31, firstY: 239, secondX: 191, secondY: 302, shape: 'Rectangle' },
        { guid: V_ANO, representedGuid: '2D969AF8-C875-4FAE-BCD8-F0162BC27396', name: 'another', firstX: 378, firstY: 240, secondX: 538, secondY: 303, shape: 'Rectangle' }
      ],
      edges: [
        { guid: 'AFFE2E91-FF08-4DF9-98E5-41E42CC300A3', representedGuid: LINK, sourceVertex: V_ANO, targetVertex: V_IMG, direction: 'Bidirectional' as const, lineStyle: 'solid' as const }
      ]
    }
    const links = new Map([[LINK, { guid: LINK, name: 'contradicts', direction: 'Bidirectional' as const, originGuid: '2D969AF8-C875-4FAE-BCD8-F0162BC27396', targetGuid: '2A08BDDF-4C35-4250-BF77-7DE37B50C930' }]])
    const entities: Record<string, any> = {
      [DOC_GUID]: { kind: 'document', label: 'magnoliasolid.png', sourceType: 'image' },
      '2A08BDDF-4C35-4250-BF77-7DE37B50C930': { kind: 'code', label: 'image', codeColor: '#E05050' },
      '2D969AF8-C875-4FAE-BCD8-F0162BC27396': { kind: 'code', label: 'another', codeColor: '#E08050' }
    }
    const analysis = graphToMap(graph, { resolveEntity: (g) => entities[g] ?? null, links })

    // All three vertices come back as proper entity elements, not free-text.
    expect(analysis.config.elements).toHaveLength(3)
    expect(analysis.config.freeTexts).toHaveLength(0)
    const doc = analysis.config.elements.find((e) => e.entityGuid === DOC_GUID)!
    expect(doc.kind).toBe('document')
    expect(doc.sourceType).toBe('image')
    const code = analysis.config.elements.find((e) => e.label === 'image')!
    expect(code.kind).toBe('code')
    expect(code.codeColor).toBe('#E05050')

    // Imported nodes use Magnolia's native chip size, not Atlas's taller
    // vertex box (the code vertex was 160x63, the document 160x97).
    expect(code.height).toBe(28)
    expect(code.width).toBe(160)
    expect(doc.height).toBe(28)
    // Foreign POSITION is preserved so the layout matches the source.
    expect(doc.x).toBe(231)
    expect(doc.y).toBe(97)

    // The edge recovers its label + bidirectional arrows from the <Link>.
    expect(analysis.config.connections).toHaveLength(1)
    const conn = analysis.config.connections[0]
    expect(conn.label).toBe('contradicts')
    expect(conn.arrowFrom).toBe(true)
    expect(conn.arrowTo).toBe(true)
  })
})
