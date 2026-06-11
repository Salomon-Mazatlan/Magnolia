/**
 * Reports — headless regeneration of analysis tables into HTML for the
 * report PDF. Each generator rebuilds the tool's grid from the saved
 * config against fresh init data (so the PDF never carries stale data),
 * mirroring the on-screen computation, and emits a print-friendly table
 * honouring the per-item display options (Totals Only / Binary /
 * Visual).
 *
 * Tools land here one at a time; anything not yet implemented falls back
 * to a short placeholder so the rest of the report still renders.
 */
import { buildAnalysisInitData } from '../../utils/build-analysis-init-data'
import {
  applySurveyCellScope,
  resolveFilteredSources,
  countCodeInSource,
  countCoOccurrences,
  binarizeGrid
} from './analysis-helpers'
import { buildSurveyAwareColumns } from './survey-grouping'
import { emptyDocumentFilter } from '../DocumentSelector/DocumentSelector'
import { escHtml } from '../../utils/pdf-export'
import { TOOL_REGISTRY } from '../../utils/tool-registry'
import { useProjectStore } from '../../stores/project-store'
import type { AnalysisInitData } from '../../models/types'
import type { AnalysisItemOptions, ReportItem } from './report-export'

/** CSS for the report's regenerated analysis tables, appended to the
 *  export document's styles. */
export const REPORT_TABLE_CSS = `
  table.report-table { width: auto; border-collapse: collapse; font-size: 10px; margin: 2px 0 6px 0; }
  table.report-table th, table.report-table td { border: 1px solid #ddd; padding: 3px 6px; text-align: center; white-space: nowrap; }
  table.report-table th.rowhead, table.report-table td.rowhead { text-align: left; font-weight: 600; }
  table.report-table th { background: #f3f4f6; color: #555; font-size: 9px; font-weight: 600; }
  table.report-table td.sub { background: #eef1f5; font-weight: 600; }
  table.report-table td.pct { background: #f6f7f9; font-style: italic; color: #666; }
  table.report-table tr.total td { border-top: 2px solid #bbb; font-weight: 700; }
  table.report-table td.zero { color: #bbb; }
`

function pctOf(value: number, total: number): string {
  if (!total) return ''
  return ((value / total) * 100).toFixed(1) + '%'
}

/** Light→strong tint for a "visual" heatmap cell, mirroring the on-screen
 *  red ramp. */
function heatStyle(value: number, maxVal: number): string {
  if (value <= 0) return ''
  const ratio = Math.min(1, value / Math.max(1, maxVal))
  const r = Math.round(255)
  const g = Math.round(235 - ratio * 150)
  const b = Math.round(235 - ratio * 150)
  return ` style="background:rgb(${r},${g},${b})"`
}

// ── Codes in Documents ─────────────────────────────────────────────

function codesInDocumentsHtml(config: any, options: AnalysisItemOptions): string {
  const docFilter = config?.docFilter ?? emptyDocumentFilter()
  const codeGuids: string[] = config?.codeGuids ?? []
  if (codeGuids.length === 0) return '<div class="empty">(no codes in this analysis)</div>'

  const base = buildAnalysisInitData('codes-in-documents')
  let data = applySurveyCellScope(base, docFilter)
  const questionScope = config?.questionScope ?? []
  if (questionScope.length) data = applySurveyCellScope(data, { questionScope })

  const filtered = resolveFilteredSources(
    data,
    docFilter.sourceGuids ?? [],
    docFilter.tagGuids ?? [],
    docFilter.tagExcludeGuids ?? [],
    docFilter.typeInclude ?? [],
    docFilter.typeExclude ?? []
  )
  const sourceMap = new Map<string, string>(data.sources.map((s) => [s.guid, s.name]))
  const codeMap = new Map(data.codes.map((c) => [c.guid, c]))
  const groupBy = config?.groupBy ?? []
  const { columns } = buildSurveyAwareColumns(groupBy, data, filtered, sourceMap)

  // Per-column survey-cell scope, exactly as the component does it.
  const colData = new Map<string, AnalysisInitData>()
  for (const col of columns) {
    colData.set(
      col.id,
      col.respondentRef
        ? applySurveyCellScope(data, { respondentScope: [col.respondentRef] })
        : col.tagScopeGuids
          ? applySurveyCellScope(data, { tagGuids: col.tagScopeGuids })
          : data
    )
  }
  let grid = codeGuids.map((cg) =>
    columns.map((col) => {
      const cd = colData.get(col.id) || data
      return col.sourceGuids.reduce((sum, sg) => sum + countCodeInSource(cd, sg, cg), 0)
    })
  )
  const binary = !!options.binary
  if (binary) grid = binarizeGrid(grid)

  const rowTotals = grid.map((row) => row.reduce((s, v, j) => (columns[j].isSubtotal ? s : s + v), 0))
  const colTotals = columns.map((_, j) => grid.reduce((s, row) => s + row[j], 0))
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0)
  let maxVal = 1
  for (let i = 0; i < grid.length; i++) for (let j = 0; j < columns.length; j++) if (!columns[j].isSubtotal && grid[i][j] > maxVal) maxVal = grid[i][j]

  const totalsOnly = !!options.totalsOnly
  const visual = !!options.visual
  const visIdx = columns.map((_, j) => j).filter((j) => (totalsOnly ? columns[j].isSubtotal : true))

  // Header
  const headCells = visIdx
    .map((j) => `<th class="${columns[j].isSubtotal ? 'sub' : ''}">${escHtml(columns[j].label)}</th>${columns[j].isSubtotal ? '<th class="sub">%</th>' : ''}`)
    .join('')
  const thead = `<tr><th class="rowhead">Code</th>${headCells}<th>Total</th><th>% of Total</th></tr>`

  // Body
  const body = codeGuids
    .map((cg, i) => {
      const cells = visIdx
        .map((j) => {
          const v = grid[i][j]
          const cls = columns[j].isSubtotal ? 'sub' : v === 0 ? 'zero' : ''
          const style = visual && !columns[j].isSubtotal ? heatStyle(v, maxVal) : ''
          const main = `<td class="${cls}"${style}>${v}</td>`
          const pctCell = columns[j].isSubtotal
            ? `<td class="pct">${binary ? '–' : pctOf(grid[i][j], rowTotals[i]) || '–'}</td>`
            : ''
          return main + pctCell
        })
        .join('')
      const name = codeMap.get(cg)?.name ?? 'Code'
      return `<tr><td class="rowhead">${escHtml(name)}</td>${cells}<td>${rowTotals[i]}</td><td class="pct">${pctOf(rowTotals[i], grandTotal) || '–'}</td></tr>`
    })
    .join('')

  // Total row
  const totalCells = visIdx
    .map((j) => {
      const ct = colTotals[j]
      const cls = columns[j].isSubtotal ? 'sub' : ''
      const pctCell = columns[j].isSubtotal ? `<td class="pct">${binary ? '–' : pctOf(ct, grandTotal) || '–'}</td>` : ''
      return `<td class="${cls}">${ct}</td>${pctCell}`
    })
    .join('')
  const totalRow = `<tr class="total"><td class="rowhead">Total</td>${totalCells}<td>${grandTotal}</td><td class="pct">${grandTotal ? '100.0%' : '–'}</td></tr>`

  return wrapTable(`<thead>${thead}</thead><tbody>${body}${totalRow}</tbody>`, visIdx.length)
}

// ── Code Co-Occurrences ────────────────────────────────────────────

function codeCoOccurrencesHtml(config: any, options: AnalysisItemOptions): string {
  const docFilter = config?.docFilter ?? emptyDocumentFilter()
  const rowCodeGuids: string[] = config?.rowCodeGuids ?? []
  const colCodeGuids: string[] = config?.colCodeGuids ?? []
  if (rowCodeGuids.length === 0 || colCodeGuids.length === 0) return '<div class="empty">(no codes in this analysis)</div>'

  const base = buildAnalysisInitData('code-cooccurrences')
  const data = applySurveyCellScope(base, docFilter)
  const filtered = resolveFilteredSources(
    data,
    docFilter.sourceGuids ?? [],
    docFilter.tagGuids ?? [],
    docFilter.tagExcludeGuids ?? [],
    docFilter.typeInclude ?? [],
    docFilter.typeExclude ?? []
  )
  const codeMap = new Map(data.codes.map((c) => [c.guid, c]))

  let matrix = rowCodeGuids.map((rg) =>
    colCodeGuids.map((cg) => (rg === cg ? 0 : countCoOccurrences(data, filtered, rg, cg)))
  )
  const binary = !!options.binary
  if (binary) matrix = binarizeGrid(matrix)

  const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0))
  const colTotals = colCodeGuids.map((_, j) => matrix.reduce((s, row) => s + row[j], 0))
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0)
  let maxVal = 1
  for (const row of matrix) for (const v of row) if (v > maxVal) maxVal = v
  const visual = !!options.visual
  const totalsOnly = !!options.totalsOnly

  // Totals-only for a matrix (no subtotals): just the Total column + row.
  const thead = totalsOnly
    ? `<tr><th class="rowhead"></th><th>Total</th><th>% of Total</th></tr>`
    : `<tr><th class="rowhead"></th>${colCodeGuids.map((g) => `<th>${escHtml(codeMap.get(g)?.name ?? 'Code')}</th>`).join('')}<th>Total</th><th>% of Total</th></tr>`

  const body = rowCodeGuids
    .map((rg, i) => {
      const name = codeMap.get(rg)?.name ?? 'Code'
      const cells = totalsOnly
        ? ''
        : colCodeGuids
            .map((cg, j) => {
              if (rg === cg) return '<td class="zero">—</td>'
              const v = matrix[i][j]
              const style = visual ? heatStyle(v, maxVal) : ''
              return `<td class="${v === 0 ? 'zero' : ''}"${style}>${v}</td>`
            })
            .join('')
      return `<tr><td class="rowhead">${escHtml(name)}</td>${cells}<td>${rowTotals[i]}</td><td class="pct">${pctOf(rowTotals[i], grandTotal) || '–'}</td></tr>`
    })
    .join('')

  const totalRow = totalsOnly
    ? `<tr class="total"><td class="rowhead">Total</td><td>${grandTotal}</td><td class="pct">${grandTotal ? '100.0%' : '–'}</td></tr>`
    : `<tr class="total"><td class="rowhead">Total</td>${colTotals.map((ct) => `<td>${ct}</td>`).join('')}<td>${grandTotal}</td><td class="pct">${grandTotal ? '100.0%' : '–'}</td></tr>`

  const colCount = totalsOnly ? 0 : colCodeGuids.length
  return wrapTable(`<thead>${thead}</thead><tbody>${body}${totalRow}</tbody>`, colCount)
}

/** Wrap a table; flag wide ones so the export CSS can rotate/scale them
 *  (handled in a later phase). */
function wrapTable(inner: string, dataColCount: number): string {
  const wide = dataColCount > 12
  return `<div class="report-wide${wide ? ' report-wide-rotate' : ''}"><table class="report-table">${inner}</table></div>`
}

/** Render one analysis item: regenerate its table fresh, or a short
 *  placeholder for tools not yet implemented / deleted analyses. */
export function renderAnalysisItemHtml(
  item: Extract<ReportItem, { kind: 'analysis' }>,
  anchor: string
): string {
  const sa = useProjectStore.getState().savedAnalyses?.find((a) => a.guid === item.refGuid)
  const toolLabel = TOOL_REGISTRY[item.toolType]?.label ?? 'Analysis'
  if (!sa) {
    return `<div class="report-block" id="${anchor}"><div class="report-item-head">${escHtml(toolLabel)}</div><div class="empty">(deleted analysis)</div></div>`
  }
  const head = `<div class="report-item-head">${escHtml(toolLabel)} — ${escHtml(sa.name)}</div>`
  let inner: string
  try {
    switch (sa.toolType) {
      case 'codes-in-documents':
        inner = codesInDocumentsHtml(sa.config, item.options)
        break
      case 'code-cooccurrences':
        inner = codeCoOccurrencesHtml(sa.config, item.options)
        break
      default:
        inner = `<div class="empty">${escHtml(sa.name)} — table generation for ${escHtml(toolLabel)} is coming soon.</div>`
    }
  } catch {
    inner = '<div class="empty">Could not regenerate this analysis.</div>'
  }
  return `<div class="report-block" id="${anchor}">${head}${inner}</div>`
}
