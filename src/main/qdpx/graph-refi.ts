/**
 * Relationship Map ⇄ REFI-QDA Graphs interop layer.
 *
 * Magnolia stores each Relationship Map as a SavedAnalysis
 * (`toolType: 'relationship-map'`) whose `config` is a
 * RelationshipMapConfig — `{ elements, freeTexts, connections, pan }`.
 * That round-trips perfectly Magnolia↔Magnolia via the
 * `magnolia-analyses.json` side-table, but is invisible to Atlas.ti /
 * MAXQDA / NVivo: they drop unknown zip entries on re-export, so the map
 * vanishes the moment a project passes through another tool.
 *
 * The QDA-XML 1.0 schema has a first-class construct for exactly this —
 * `<Graphs>` of `<Graph>`s, each a set of `<Vertex>` boxes and `<Edge>`
 * lines (spec slide 15: "A project may contain graphs or maps"). This
 * module maps a Relationship Map onto that construct so the map survives
 * a round-trip through another tool:
 *
 *   - element / free-text → <Vertex>  (position + size as firstX/firstY/
 *                                      secondX/secondY, entity binding as
 *                                      representedGUID, label as name)
 *   - connection          → <Edge>    (sourceVertex/targetVertex, arrow
 *                                      heads as direction, label as name)
 *
 * Fidelity: the rich Magnolia node kinds (code vs document vs quote vs
 * survey-cell, snippets, per-tool colours, pan/zoom) can't be expressed
 * in the standard Graph, so they keep round-tripping in full via the
 * side-table. `graphToMap` is the lossy fallback used only when a file
 * arrives WITHOUT that side-table (i.e. it round-tripped through, or
 * originated in, another tool): every vertex comes back as a free-text
 * box so the map's shape and connections stay visible.
 */
import type { SavedAnalysis } from '../../renderer/models/types'

// Minimal mirrors of the renderer's RelationshipMap config shapes. Defined
// locally (rather than imported from the renderer component) so the main
// process doesn't reach across into a renderer component's internals — the
// same boundary convention survey-refi.ts follows. Only the fields this
// interop layer reads/writes are modelled; the renderer remains the owner
// of the full type in components/Analysis/RelationshipMap/types.ts.
interface MapElement {
  id: string
  kind: string
  label: string
  entityGuid?: string
  codeColor?: string
  x: number
  y: number
  width: number
  height: number
}

interface FreeTextElement {
  id: string
  kind: 'freetext'
  x: number
  y: number
  width: number
  height: number
  content: string
}

interface MapConnection {
  id: string
  fromId: string
  toId: string
  arrowFrom: boolean
  arrowTo: boolean
  label: string
}

interface RelationshipMapConfig {
  elements: MapElement[]
  freeTexts: FreeTextElement[]
  connections: MapConnection[]
  pan: { x: number; y: number }
}

export type RefiEdgeDirection = 'Associative' | 'OneWay' | 'Bidirectional'
export type RefiLineStyle = 'dotted' | 'dashed' | 'solid'

export interface RefiVertex {
  guid: string
  /** GUID of the project entity this vertex stands for (a code / source /
   *  tag / …). Omitted for free-text and other unbound vertices. */
  representedGuid?: string
  name?: string
  firstX: number
  firstY: number
  secondX?: number
  secondY?: number
  shape?: string
  color?: string
}

export interface RefiEdge {
  guid: string
  name?: string
  sourceVertex: string
  targetVertex: string
  color?: string
  direction?: RefiEdgeDirection
  lineStyle?: RefiLineStyle
}

export interface RefiGraph {
  guid: string
  name?: string
  vertices: RefiVertex[]
  edges: RefiEdge[]
}

const GUID_RE = /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/
const RGB_RE = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/

/** Only emit a representedGUID / colour when it actually satisfies the
 *  schema's GUIDType / RGBType pattern — a non-GUID entity id (e.g. a
 *  composite query-result key) or a non-hex colour would otherwise make
 *  the whole project fail validation. */
function asGuid(v: string | undefined): string | undefined {
  return v && GUID_RE.test(v) ? v : undefined
}
function asRgb(v: string | undefined): string | undefined {
  return v && RGB_RE.test(v) ? v : undefined
}

/** Translate a connection's two arrow-head flags into a REFI direction,
 *  swapping the endpoints when the only arrow points back at the source
 *  so OneWay always reads source → target. */
function directionFor(
  conn: MapConnection
): { source: string; target: string; direction: RefiEdgeDirection } {
  if (conn.arrowFrom && conn.arrowTo) {
    return { source: conn.fromId, target: conn.toId, direction: 'Bidirectional' }
  }
  if (conn.arrowTo && !conn.arrowFrom) {
    return { source: conn.fromId, target: conn.toId, direction: 'OneWay' }
  }
  if (conn.arrowFrom && !conn.arrowTo) {
    return { source: conn.toId, target: conn.fromId, direction: 'OneWay' }
  }
  return { source: conn.fromId, target: conn.toId, direction: 'Associative' }
}

function elementToVertex(el: MapElement): RefiVertex {
  return {
    guid: el.id,
    representedGuid: asGuid(el.entityGuid),
    name: el.label,
    firstX: el.x,
    firstY: el.y,
    secondX: el.x + el.width,
    secondY: el.y + el.height,
    shape: 'RoundedRectangle',
    color: asRgb(el.codeColor)
  }
}

function freeTextToVertex(ft: FreeTextElement): RefiVertex {
  return {
    guid: ft.id,
    name: ft.content,
    firstX: ft.x,
    firstY: ft.y,
    secondX: ft.x + ft.width,
    secondY: ft.y + ft.height,
    shape: 'Note'
  }
}

/** Map one relationship-map SavedAnalysis onto a REFI-QDA <Graph>. */
export function mapToGraph(analysis: SavedAnalysis): RefiGraph {
  const config = (analysis.config ?? {}) as Partial<RelationshipMapConfig>
  const vertices: RefiVertex[] = [
    ...(config.elements ?? []).map(elementToVertex),
    ...(config.freeTexts ?? []).map(freeTextToVertex)
  ]
  // Drop edges whose endpoints don't both resolve to a vertex on this
  // graph — a dangling sourceVertex/targetVertex is invalid and would
  // also confuse importing tools.
  const vertexIds = new Set(vertices.map((v) => v.guid))
  const edges: RefiEdge[] = (config.connections ?? [])
    .filter((c) => vertexIds.has(c.fromId) && vertexIds.has(c.toId))
    .map((c) => {
      const { source, target, direction } = directionFor(c)
      return {
        guid: c.id,
        name: c.label || undefined,
        sourceVertex: source,
        targetVertex: target,
        direction,
        lineStyle: 'solid' as const
      }
    })
  return { guid: analysis.guid, name: analysis.name, vertices, edges }
}

/** Collect a <Graph> for every relationship-map saved analysis in the
 *  project. Returns [] when there are none. */
export function collectGraphs(savedAnalyses: SavedAnalysis[] | undefined): RefiGraph[] {
  return (savedAnalyses ?? [])
    .filter((a) => a.toolType === 'relationship-map')
    .map(mapToGraph)
}

/**
 * Rebuild a best-effort relationship-map SavedAnalysis from a REFI-QDA
 * <Graph>. Used only for files that arrive without Magnolia's side-table
 * (foreign-authored, or a Magnolia project that lost its analyses JSON in
 * a round-trip through another tool). Every vertex becomes a free-text
 * box — the standard Graph carries no Magnolia node-kind, so we don't
 * fabricate one — preserving the map's layout and connections.
 */
export function graphToMap(graph: RefiGraph): SavedAnalysis {
  const freeTexts: FreeTextElement[] = graph.vertices.map((v) => ({
    id: v.guid,
    kind: 'freetext',
    x: v.firstX,
    y: v.firstY,
    width: v.secondX != null ? Math.max(40, v.secondX - v.firstX) : 160,
    height: v.secondY != null ? Math.max(24, v.secondY - v.firstY) : 28,
    content: v.name ?? ''
  }))
  const connections: MapConnection[] = graph.edges.map((e) => ({
    id: e.guid,
    fromId: e.sourceVertex,
    toId: e.targetVertex,
    arrowFrom: e.direction === 'Bidirectional',
    arrowTo: e.direction === 'OneWay' || e.direction === 'Bidirectional',
    label: e.name ?? ''
  }))
  const config: RelationshipMapConfig = { elements: [], freeTexts, connections, pan: { x: 0, y: 0 } }
  return {
    guid: graph.guid,
    toolType: 'relationship-map',
    name: graph.name || 'Imported Map',
    config,
    createdDateTime: ''
  }
}
