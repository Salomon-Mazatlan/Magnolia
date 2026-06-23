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
  /** GUID of the project-level <Link> this edge visualises. Atlas keys a
   *  network link to its relation here; without it the edge is dropped. */
  representedGuid?: string
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

/** A project-level REFI-QDA <Link> — the entity-to-entity relation an
 *  <Edge> represents. originGUID/targetGUID point at the linked *entities*
 *  (a vertex's representedGUID), not the vertices. */
export interface RefiLink {
  guid: string
  name?: string
  direction?: RefiEdgeDirection
  color?: string
  originGuid?: string
  targetGuid?: string
}

/** A synthetic <Note> minted to give an otherwise-unbound vertex (a
 *  free-text box) a representedGUID, since Atlas drops vertices that
 *  represent nothing. Carries the box's text so it stays portable. */
export interface RefiSyntheticNote {
  guid: string
  name: string
  content: string
}

/** Everything the serializer needs to emit a project's maps in the
 *  standards-native form: the <Graph>s, the <Link>s their edges
 *  reference, and the synthetic <Note>s their free-text vertices
 *  represent. */
export interface GraphBundle {
  graphs: RefiGraph[]
  links: RefiLink[]
  notes: RefiSyntheticNote[]
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

/** Flip the first hex nibble of a guid: deterministic, reversible, and
 *  guaranteed to differ from the input (15 - n === n has no solution in
 *  0..15). Used to mint a distinct-but-stable derived guid. */
function flipFirstNibble(guid: string): string {
  const n = parseInt(guid[0], 16)
  if (Number.isNaN(n)) return guid
  return (15 - n).toString(16).toUpperCase() + guid.slice(1)
}

/** A free-text box's backing <Note> guid (derived from the box id). */
function noteGuidFor(freeTextId: string): string {
  return flipFirstNibble(freeTextId)
}

/** A connection's backing <Link> guid (derived from the connection id, so
 *  it's distinct from the <Edge> guid, which is the connection id). */
function linkGuidFor(connectionId: string): string {
  return flipFirstNibble(connectionId)
}

/** First non-empty line of a free-text box, for the backing note's name. */
function firstLine(content: string): string {
  const line = (content || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return line ? line.replace(/^#+\s*/, '').slice(0, 80) : 'Free text'
}

/**
 * Build the standards-native representation of one relationship-map
 * SavedAnalysis: a <Graph> plus the <Link>s its edges reference and the
 * synthetic <Note>s its free-text vertices represent.
 *
 * Atlas (and the REFI model generally) treats a vertex as a *view of an
 * entity* and an edge as a *view of a Link between entities* — it drops
 * any vertex without a representedGUID and any edge without one. So:
 *   - every element vertex represents its bound entity; every free-text
 *     vertex represents a freshly-minted <Note> carrying its text;
 *   - every connection becomes a project-level <Link> (origin/target =
 *     the endpoints' entities) plus an <Edge> that representedGUID-points
 *     at that Link (and still wires the vertices via sourceVertex/
 *     targetVertex, which Atlas keys on).
 */
export function mapToGraph(analysis: SavedAnalysis): GraphBundle {
  const config = (analysis.config ?? {}) as Partial<RelationshipMapConfig>
  const notes: RefiSyntheticNote[] = []
  // vertexId → the entity guid that vertex represents (real entity for a
  // bound element; the synthetic note for a free-text box).
  const represented = new Map<string, string>()

  const vertices: RefiVertex[] = []
  for (const el of config.elements ?? []) {
    const rep = asGuid(el.entityGuid)
    if (rep) represented.set(el.id, rep)
    vertices.push({
      guid: el.id,
      representedGuid: rep,
      name: el.label,
      firstX: el.x,
      firstY: el.y,
      secondX: el.x + el.width,
      secondY: el.y + el.height,
      shape: 'RoundedRectangle',
      color: asRgb(el.codeColor)
    })
  }
  for (const ft of config.freeTexts ?? []) {
    const noteGuid = noteGuidFor(ft.id)
    notes.push({ guid: noteGuid, name: firstLine(ft.content), content: ft.content ?? '' })
    represented.set(ft.id, noteGuid)
    vertices.push({
      guid: ft.id,
      representedGuid: noteGuid,
      name: ft.content,
      firstX: ft.x,
      firstY: ft.y,
      secondX: ft.x + ft.width,
      secondY: ft.y + ft.height,
      shape: 'Note'
    })
  }

  // Drop edges whose endpoints don't both resolve to a vertex on this graph.
  const vertexIds = new Set(vertices.map((v) => v.guid))
  const links: RefiLink[] = []
  const edges: RefiEdge[] = []
  for (const c of config.connections ?? []) {
    if (!vertexIds.has(c.fromId) || !vertexIds.has(c.toId)) continue
    const { source, target, direction } = directionFor(c)
    const edge: RefiEdge = {
      guid: c.id,
      name: c.label || undefined,
      sourceVertex: source,
      targetVertex: target,
      direction,
      lineStyle: 'solid'
    }
    // Back the edge with a <Link> when both endpoints resolve to an
    // entity — Atlas needs that relation to render the link. (After the
    // free-text→Note backing above, both ends resolve unless an element
    // had no GUID entity binding, e.g. a query-result composite id.)
    const originGuid = represented.get(source)
    const targetGuid = represented.get(target)
    if (originGuid && targetGuid) {
      const linkGuid = linkGuidFor(c.id)
      links.push({ guid: linkGuid, name: c.label || undefined, direction, originGuid, targetGuid })
      edge.representedGuid = linkGuid
    }
    edges.push(edge)
  }

  return {
    graphs: [{ guid: analysis.guid, name: analysis.name, vertices, edges }],
    links,
    notes
  }
}

/** Collect the graphs, links, and synthetic notes for every
 *  relationship-map saved analysis in the project. */
export function collectGraphs(savedAnalyses: SavedAnalysis[] | undefined): GraphBundle {
  const out: GraphBundle = { graphs: [], links: [], notes: [] }
  for (const a of savedAnalyses ?? []) {
    if (a.toolType !== 'relationship-map') continue
    const bundle = mapToGraph(a)
    out.graphs.push(...bundle.graphs)
    out.links.push(...bundle.links)
    out.notes.push(...bundle.notes)
  }
  return out
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
