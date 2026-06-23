import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi } from 'vitest'
import { validateXML } from 'xmllint-wasm'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

import { serializeProject } from '../../src/main/qdpx/xml-serializer'
import { mapToGraph, graphToMap } from '../../src/main/qdpx/graph-refi'
import type { Project, SavedAnalysis } from '../../src/renderer/models/types'

const PROJECT_XSD = readFileSync(join(__dirname, '../fixtures/Project.xsd'), 'utf8')

async function validate(xml: string): Promise<{ valid: boolean; errors: unknown[] }> {
  const result = await validateXML({
    xml: [{ fileName: 'project.qde', contents: xml }],
    schema: [PROJECT_XSD]
  })
  return { valid: result.valid, errors: result.errors }
}

const CODE_GUID = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'
const EL1 = 'E1111111-1111-1111-1111-111111111111'
const EL2 = 'E2222222-2222-2222-2222-222222222222'
const FT1 = 'F1111111-1111-1111-1111-111111111111'
const CONN1 = 'C1111111-1111-1111-1111-111111111111'

/** A relationship-map SavedAnalysis: two entity elements, one free-text
 *  box, and a directed connection between the elements. */
function mapAnalysis(): SavedAnalysis {
  return {
    guid: 'A1111111-1111-1111-1111-111111111111',
    toolType: 'relationship-map',
    name: 'My Map',
    createdDateTime: '2024-01-01T00:00:00Z',
    config: {
      pan: { x: 0, y: 0 },
      elements: [
        { id: EL1, kind: 'code', label: 'Theme A', entityGuid: CODE_GUID, codeColor: '#FF8800', x: 10, y: 20, width: 160, height: 28 },
        // entityGuid here is a non-GUID composite key — must NOT become a representedGUID.
        { id: EL2, kind: 'query-result', label: 'A quote', entityGuid: 'qr:not-a-guid', x: 200.4, y: 50.9, width: 220, height: 72 }
      ],
      freeTexts: [
        { id: FT1, kind: 'freetext', x: 5, y: 200, width: 200, height: 60, content: 'Some note' }
      ],
      connections: [
        { id: CONN1, fromId: EL1, toId: EL2, arrowFrom: false, arrowTo: true, label: 'leads to' }
      ]
    }
  }
}

function projectWithMap(): Project {
  return {
    name: 'Graph Project',
    origin: 'Magnolia test',
    users: [{ guid: '00000000-0000-0000-0000-000000000001', name: 'T' }],
    codes: [{ guid: CODE_GUID, name: 'Theme A', isCodable: true, children: [] }],
    sources: [],
    sets: [],
    notes: [],
    savedAnalyses: [
      mapAnalysis(),
      // A non-map analysis must be ignored by the graph collector.
      { guid: 'B2222222-2222-2222-2222-222222222222', toolType: 'code-frequencies', name: 'Freqs', createdDateTime: '2024-01-01T00:00:00Z', config: {} }
    ]
  }
}

describe('Relationship Map → REFI-QDA <Graphs>', () => {
  it('serializes a project with a relationship map that validates against Project.xsd', async () => {
    const xml = serializeProject(projectWithMap())
    const { valid, errors } = await validate(xml)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('emits exactly one <Graph> (only the relationship-map analysis)', () => {
    const xml = serializeProject(projectWithMap())
    expect((xml.match(/<Graph\b/g) || []).length).toBe(1)
    // GraphType sequence is Vertex*, Edge* — Vertex must precede Edge.
    expect(xml.indexOf('<Vertex')).toBeLessThan(xml.indexOf('<Edge'))
  })

  it('mapToGraph maps elements + free-texts to vertices and connections to edges', () => {
    const g = mapToGraph(mapAnalysis())
    expect(g.vertices).toHaveLength(3) // 2 elements + 1 free-text
    expect(g.edges).toHaveLength(1)

    const v1 = g.vertices.find((v) => v.guid === EL1)!
    expect(v1.representedGuid).toBe(CODE_GUID) // valid GUID → bound
    expect(v1.secondX).toBe(170) // x(10) + width(160)
    expect(v1.color).toBe('#FF8800')

    const v2 = g.vertices.find((v) => v.guid === EL2)!
    expect(v2.representedGuid).toBeUndefined() // non-GUID entityGuid dropped

    const edge = g.edges[0]
    expect(edge.sourceVertex).toBe(EL1)
    expect(edge.targetVertex).toBe(EL2)
    expect(edge.direction).toBe('OneWay') // arrowTo only
  })

  it('drops edges whose endpoints are not both present as vertices', () => {
    const a = mapAnalysis()
    a.config.connections.push({ id: 'C9999999-9999-9999-9999-999999999999', fromId: EL1, toId: 'MISSING', arrowFrom: false, arrowTo: true, label: '' })
    const g = mapToGraph(a)
    expect(g.edges).toHaveLength(1) // the dangling edge is removed
  })

  it('graphToMap rebuilds a foreign graph as free-text boxes + connections', () => {
    const g = mapToGraph(mapAnalysis())
    const analysis = graphToMap(g)
    expect(analysis.toolType).toBe('relationship-map')
    expect(analysis.config.elements).toHaveLength(0)
    expect(analysis.config.freeTexts).toHaveLength(3)
    expect(analysis.config.connections).toHaveLength(1)
    const conn = analysis.config.connections[0]
    expect(conn.arrowTo).toBe(true)
    expect(conn.arrowFrom).toBe(false)
  })
})
