import type { MapElement, MapConnection, FreeTextElement, MapElementKind } from './types'
import { ELEMENT_COLORS, ANALYSIS_TOOL_COLORS } from './types'
import {
  bezPathFromPorts,
  arcMidpoint,
  parseArcPath,
  distributePortsForElement,
  computePortPosition
} from './bezier-utils'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getColor(el: MapElement): string {
  if (el.kind === 'analysis' && el.analysisToolType) {
    return ANALYSIS_TOOL_COLORS[el.analysisToolType] || ELEMENT_COLORS.analysis
  }
  return ELEMENT_COLORS[el.kind]
}

// Lucide icon SVG bodies (24x24 viewBox; stroked, not filled). The
// renderer wraps each body in a <g> that sets stroke/fill/etc. so the
// inner elements only need their geometric attributes. Names match the
// in-app icon registry (see ../../components/icons/lucide.ts).
const LUCIDE_ICONS: Record<string, string> = {
  file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  tags: '<path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z"/><path d="M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193"/><circle cx="10.5" cy="6.5" r=".5" fill="currentColor"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  paperclip: '<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/>',
  'file-code-corner': '<path d="M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m5 16-3 3 3 3"/><path d="m9 22 3-3-3-3"/>',
  'file-search-corner': '<path d="M11.1 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.589 3.588A2.4 2.4 0 0 1 20 8v3.25"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m21 22-2.88-2.88"/><circle cx="16" cy="17" r="3"/>',
  'squares-intersect': '<path d="M10 22a2 2 0 0 1-2-2"/><path d="M14 2a2 2 0 0 1 2 2"/><path d="M16 22h-2"/><path d="M2 10V8"/><path d="M2 4a2 2 0 0 1 2-2"/><path d="M20 8a2 2 0 0 1 2 2"/><path d="M22 14v2"/><path d="M22 20a2 2 0 0 1-2 2"/><path d="M4 16a2 2 0 0 1-2-2"/><path d="M8 10a2 2 0 0 1 2-2h5a1 1 0 0 1 1 1v5a2 2 0 0 1-2 2H9a1 1 0 0 1-1-1z"/><path d="M8 2h2"/>',
  'chart-column': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  'list-ordered': '<path d="M11 5h10"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/>',
  type: '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
  'share-2': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'message-circle-question-mark': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'
}

const KIND_ICON_MAP: Record<MapElementKind, string | null> = {
  document: 'file',
  code: null,
  query: 'search',
  'query-result': 'search',
  memo: 'paperclip',
  analysis: null,
  tag: 'tag',
  'tag-category': 'tags',
  quote: null,
  folder: 'folder',
  // Survey node kinds — respondent and question render as chips with
  // their lucide glyph; cells render as cards (no header icon).
  'survey-respondent': 'user',
  'survey-question': 'message-circle-question-mark',
  'survey-cell': null,
}

const ANALYSIS_ICON_MAP: Record<string, string> = {
  'codes-in-documents': 'file-code-corner',
  'code-cooccurrences': 'squares-intersect',
  'code-frequencies': 'chart-column',
  'code-orders': 'list-ordered',
  'word-frequencies': 'type',
  'relationship-map': 'share-2',
}

function getIconKey(el: MapElement): string | null {
  if (el.kind === 'analysis' && el.analysisToolType) {
    return ANALYSIS_ICON_MAP[el.analysisToolType] || 'share-2'
  }
  return KIND_ICON_MAP[el.kind]
}

const STROKE_COLOR = '#3f3f46'
const CHEV_SIZE = 5

function connectionSvg(
  conn: MapConnection,
  elements: MapElement[],
  allConnections: MapConnection[]
): { lines: string; overlay: string } {
  const fromEl = elements.find((e) => e.id === conn.fromId)
  const toEl = elements.find((e) => e.id === conn.toId)
  if (!fromEl || !toEl) return { lines: '', overlay: '' }

  const fromCenter = { x: fromEl.x + fromEl.width / 2, y: fromEl.y + fromEl.height / 2 }
  const toCenter = { x: toEl.x + toEl.width / 2, y: toEl.y + toEl.height / 2 }

  // Port distribution (same as MapConnection.tsx)
  const fromConns = allConnections.filter((c) => c.fromId === conn.fromId || c.toId === conn.fromId)
  const fromTargets = new Map<string, { x: number; y: number }>()
  for (const c of fromConns) {
    const otherId = c.fromId === conn.fromId ? c.toId : c.fromId
    const other = elements.find((e) => e.id === otherId)
    if (other) fromTargets.set(c.id, { x: other.x + other.width / 2, y: other.y + other.height / 2 })
  }
  const fromPorts = distributePortsForElement(fromEl, fromConns.map((c) => c.id), fromTargets)

  const toConns = allConnections.filter((c) => c.fromId === conn.toId || c.toId === conn.toId)
  const toTargets = new Map<string, { x: number; y: number }>()
  for (const c of toConns) {
    const otherId = c.fromId === conn.toId ? c.toId : c.fromId
    const other = elements.find((e) => e.id === otherId)
    if (other) toTargets.set(c.id, { x: other.x + other.width / 2, y: other.y + other.height / 2 })
  }
  const toPorts = distributePortsForElement(toEl, toConns.map((c) => c.id), toTargets)

  const fromEdge = fromPorts.get(conn.id) || computePortPosition(fromEl, toCenter, 0)
  const toEdge = toPorts.get(conn.id) || computePortPosition(toEl, fromCenter, 0)

  const path = bezPathFromPorts(fromEdge, fromCenter, toEdge, toCenter)

  // Line (behind boxes)
  const lines = `<path d="${path}" fill="none" stroke="${STROKE_COLOR}" stroke-width="2"/>`

  // Overlay: arrowheads + label (in front of boxes)
  const overlayParts: string[] = []

  // Chevrons using midpoint for direction (matches canvas visually)
  const parsed = parseArcPath(path)
  const mid = parsed
    ? arcMidpoint(parsed.from, parsed.to, parsed.r, parsed.sweepFlag)
    : { x: (fromEdge.x + toEdge.x) / 2, y: (fromEdge.y + toEdge.y) / 2 }

  // Chevron helper: tip at `tip`, tangent is direction of travel at that point.
  // Arms extend backward (opposite to tangent). This matches the canvas rendering.
  function makeChev(tip: { x: number; y: number }, tangent: { x: number; y: number }): string {
    const bx = -tangent.x, by = -tangent.y // backward from travel
    const px = -by, py = bx // perpendicular
    const ax = tip.x + bx * CHEV_SIZE + px * CHEV_SIZE
    const ay = tip.y + by * CHEV_SIZE + py * CHEV_SIZE
    const cx = tip.x + bx * CHEV_SIZE - px * CHEV_SIZE
    const cy = tip.y + by * CHEV_SIZE - py * CHEV_SIZE
    return `${ax},${ay} ${tip.x},${tip.y} ${cx},${cy}`
  }

  if (conn.arrowFrom) {
    // Tangent at from-edge: direction from fromEdge toward midpoint (= line leaves from-box)
    const dx = mid.x - fromEdge.x, dy = mid.y - fromEdge.y
    const len = Math.hypot(dx, dy)
    if (len > 0.1) {
      // Flip tangent so chevron points INTO from-box
      const tangent = { x: -dx / len, y: -dy / len }
      overlayParts.push(`<polyline points="${makeChev(fromEdge, tangent)}" fill="none" stroke="${STROKE_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)
    }
  }

  if (conn.arrowTo) {
    // Tangent at to-edge: direction from midpoint toward toEdge (= line arrives at to-box)
    const dx = toEdge.x - mid.x, dy = toEdge.y - mid.y
    const len = Math.hypot(dx, dy)
    if (len > 0.1) {
      // Use tangent as-is: chevron points INTO to-box
      const tangent = { x: dx / len, y: dy / len }
      overlayParts.push(`<polyline points="${makeChev(toEdge, tangent)}" fill="none" stroke="${STROKE_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)
    }
  }

  // Label
  if (conn.label) {
    const lw = conn.label.length * 6.6 + 16
    overlayParts.push(
      `<rect x="${mid.x - lw / 2}" y="${mid.y - 9}" width="${lw}" height="18" rx="4" fill="#fff" stroke="${STROKE_COLOR}" stroke-width="0.5"/>`,
      `<text x="${mid.x}" y="${mid.y + 4}" text-anchor="middle" font-size="11" font-weight="500" fill="${STROKE_COLOR}">${escapeXml(conn.label)}</text>`
    )
  }

  return { lines, overlay: overlayParts.join('\n') }
}

function elementSvg(el: MapElement): string {
  const color = getColor(el)
  const headerH = 18
  const isDoc = el.kind === 'document'
  const label = el.label
  const charsPerLine = Math.floor((el.width - 16) / 7)
  const lines = isDoc ? Math.ceil(label.length / Math.max(charsPerLine, 1)) : 1
  const totalH = Math.max(el.height, headerH + lines * 16 + 6)

  const parts = [
    // Box background with border
    `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${totalH}" rx="8" fill="#fff" stroke="${color}" stroke-width="2"/>`,
    // Header background (clipped to box border-radius)
    `<clipPath id="clip-${el.id}"><rect x="${el.x}" y="${el.y}" width="${el.width}" height="${totalH}" rx="8"/></clipPath>`,
    `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${headerH}" fill="${color}" clip-path="url(#clip-${el.id})"/>`,
  ]

  // Header contents: [pip/icon] [gap] KIND_LABEL
  // Track cursor x position in the header
  let hx = el.x + 8
  const hy = el.y + 9 // vertical center of header

  // Code color pip
  if (el.kind === 'code' && el.codeColor) {
    parts.push(`<circle cx="${hx + 4}" cy="${hy}" r="4" fill="${el.codeColor}" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>`)
    hx += 12 // pip width + gap
  }

  // Icon (Lucide stroke-based icon scaled to ~10px square; viewBox is
  // always 24x24, so the scale factor is the rendered size / 24).
  const iconKey = getIconKey(el)
  if (iconKey && LUCIDE_ICONS[iconKey]) {
    const body = LUCIDE_ICONS[iconKey]
    const iconSize = 10
    const scale = iconSize / 24
    const ix = hx
    const iy = hy - iconSize / 2
    // strokeWidth is in icon-space units; 2 / scale keeps the visible
    // stroke ~2 px regardless of the rendered icon size. Wait — no: we
    // want the stroke to match Lucide's 2-unit default in icon-space,
    // and the parent group's scale handles the visual size. So
    // strokeWidth=2 in icon units renders proportionally.
    parts.push(`<g transform="translate(${ix},${iy}) scale(${scale})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`)
    hx += iconSize + 4 // icon width + gap
  }

  // Kind label text
  parts.push(`<text x="${hx}" y="${hy + 3.5}" font-size="9" font-weight="700" fill="#fff" letter-spacing="0.5">${escapeXml(el.kind.toUpperCase())}</text>`)

  // Body label text
  if (isDoc) {
    let y = el.y + headerH + 14
    let remaining = label
    while (remaining.length > 0) {
      const line = remaining.substring(0, charsPerLine)
      remaining = remaining.substring(charsPerLine)
      parts.push(`<text x="${el.x + 8}" y="${y}" font-size="12" font-weight="500" fill="#1d1d1f">${escapeXml(line)}</text>`)
      y += 16
    }
  } else {
    const displayLabel = label.length > 18 ? label.slice(0, 18) + '...' : label
    parts.push(`<text x="${el.x + 8}" y="${el.y + headerH + 14}" font-size="12" font-weight="500" fill="#1d1d1f">${escapeXml(displayLabel)}</text>`)
  }

  return parts.join('\n')
}

function freeTextSvg(ft: FreeTextElement): string {
  const lines = (ft.content || '').split('\n')
  const parts: string[] = []
  let y = ft.y + 16
  for (const line of lines) {
    const isHeading = line.startsWith('#')
    const level = isHeading ? (line.match(/^#{1,3}/) || [''])[0].length : 0
    const text = isHeading ? line.replace(/^#{1,3}\s*/, '') : line
    const cleanText = text.replace(/\*\*/g, '') // strip bold markers
    const fontSize = level === 1 ? 24 : level === 2 ? 20 : level === 3 ? 16 : 14
    const fontWeight = level > 0 || text.includes('**') ? '700' : '400'
    if (cleanText.trim()) {
      parts.push(
        `<text x="${ft.x + ft.width / 2}" y="${y}" text-anchor="middle" font-size="${fontSize}" font-weight="${fontWeight}" fill="#1d1d1f">${escapeXml(cleanText)}</text>`
      )
    }
    y += fontSize + 6
  }
  return parts.join('\n')
}

export function buildExportSvg(
  elements: MapElement[],
  connections: MapConnection[],
  freeTexts: FreeTextElement[]
): string {
  const allItems = [
    ...elements.map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height })),
    ...freeTexts.map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height }))
  ]

  if (allItems.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><text x="200" y="150" text-anchor="middle" fill="#999">Empty relationship map</text></svg>'
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const item of allItems) {
    minX = Math.min(minX, item.x)
    minY = Math.min(minY, item.y)
    maxX = Math.max(maxX, item.x + item.w)
    maxY = Math.max(maxY, item.y + item.h)
  }
  const pad = 40
  minX -= pad; minY -= pad; maxX += pad; maxY += pad
  const w = maxX - minX
  const h = maxY - minY

  // Render in the same layer order as the canvas:
  // 1. Connection lines (behind boxes)
  // 2. Element boxes
  // 3. Free text
  // 4. Connection overlays — arrowheads and labels (in front of boxes)
  const connResults = connections.map((c) => connectionSvg(c, elements, connections))
  const linesSvg = connResults.map((r) => r.lines).join('\n')
  const overlaysSvg = connResults.map((r) => r.overlay).join('\n')
  const elementsSvg = elements.map(elementSvg).join('\n')
  const freeTextsSvg = freeTexts.map(freeTextSvg).join('\n')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}">`,
    `<style>text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }</style>`,
    `<defs></defs>`,
    `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#fff"/>`,
    `<!-- Connection lines (behind boxes) -->`,
    linesSvg,
    `<!-- Element boxes -->`,
    elementsSvg,
    `<!-- Free text -->`,
    freeTextsSvg,
    `<!-- Arrowheads and labels (in front of boxes) -->`,
    overlaysSvg,
    `</svg>`
  ].join('\n')
}
