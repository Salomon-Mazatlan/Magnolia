/**
 * Reports — an analysis tool for compiling results (saved queries,
 * analyses, quotes, memos) plus authored sections and free text into a
 * single ordered list, exported as a PDF using Magnolia's shared
 * template. Everything is regenerated from the live stores at export
 * time so the PDF never carries stale data.
 *
 * Phase 1: the tool shell — toolbar (draggable Section / Text), the
 * reorderable list with drop targets for every supported drag source,
 * per-analysis options, save / reopen, and PDF export of the non-
 * analysis content. Analysis-table generation lands in a later phase.
 */
import { useState, useMemo, useCallback } from 'react'
import type { AnalysisInitData, AnalysisToolType } from '../../models/types'
import {
  Icon,
  faClipboardList,
  faXmark,
  faHeading1,
  faFont,
  faBars,
  faMagnifyingGlass,
  faQuoteLeft,
  faStickyNote
} from '../Icon'
import { TOOL_REGISTRY } from '../../utils/tool-registry'
import { MarkdownEditor } from '../MarkdownEditor'
import { generateGuid } from '../../utils/guid'
import { EditableTitleSuffix } from '../EditableTitleSuffix'
import { renameSavedAnalysis } from '../../utils/rename-saved-analysis'
import { useToolDirtyState } from '../../hooks/use-tool-dirty-state'
import { useRegisterToolSave } from '../../hooks/use-register-tool-save'
import { useQueryStore } from '../../stores/query-store'
import { useProjectStore } from '../../stores/project-store'
import { useQuoteStore } from '../../stores/quote-store'
import { useMemoStore } from '../../stores/memo-store'
import {
  exportReportPdf,
  reportItemTypeLabel,
  resolveItemLabel,
  type ReportItem,
  type AnalysisItemOptions
} from './report-export'

interface Props {
  data: AnalysisInitData
  savedConfig?: { title?: string; items?: ReportItem[]; guid: string; name: string }
  inTab?: {
    onClose: () => void
    onSaved: (savedGuid: string, name: string) => void
    onDirtyChange?: (dirty: boolean) => void
    tabId?: string
  }
}

const BLOCK_MIME = 'application/x-magnolia-report-block'
const REORDER_MIME = 'application/x-magnolia-report-reorder'

/** Which display options each analysis tool exposes (the toggles the
 *  tool itself shows). Drives the per-item options row. */
const ANALYSIS_CAPS: Record<string, { totalsOnly?: boolean; binary?: boolean; visual?: boolean }> = {
  'codes-in-documents': { totalsOnly: true, binary: true, visual: true },
  'results-in-documents': { totalsOnly: true, binary: true, visual: true },
  'code-cooccurrences': { totalsOnly: true, binary: true, visual: true },
  'code-frequencies': { visual: true },
  'code-orders': { visual: true },
  'word-frequencies': {},
  'relationship-map': {}
}

function itemIcon(item: ReportItem) {
  switch (item.kind) {
    case 'section':
      return faHeading1
    case 'text':
      return faFont
    case 'query':
      return faMagnifyingGlass
    case 'quote':
      return faQuoteLeft
    case 'memo':
      return faStickyNote
    case 'analysis':
      return TOOL_REGISTRY[item.toolType]?.icon ?? faClipboardList
  }
}

/** Parse a drop onto the list into one or more new report items (or null
 *  for a reorder, handled by the caller). */
function parseDrop(e: React.DragEvent): ReportItem[] {
  const block = e.dataTransfer.getData(BLOCK_MIME)
  if (block) {
    const which = block === 'text' ? 'text' : 'section'
    return [
      which === 'text'
        ? { id: generateGuid(), kind: 'text', content: '' }
        : { id: generateGuid(), kind: 'section', title: '' }
    ]
  }
  const queryRaw = e.dataTransfer.getData('application/x-magnolia-query')
  if (queryRaw) {
    try {
      const parsed = JSON.parse(queryRaw) as { guid: string } | { guid: string }[]
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      return arr.filter((q) => q?.guid).map((q) => ({ id: generateGuid(), kind: 'query', refGuid: q.guid }))
    } catch { /* ignore */ }
  }
  const jsonRaw = e.dataTransfer.getData('application/json')
  if (jsonRaw) {
    try {
      const p = JSON.parse(jsonRaw) as { kind?: string; entityGuid?: string; toolType?: AnalysisToolType }
      if (p.kind === 'analysis' && p.entityGuid && p.toolType) {
        return [{ id: generateGuid(), kind: 'analysis', refGuid: p.entityGuid, toolType: p.toolType, options: {} }]
      }
      if (p.kind === 'quote' && p.entityGuid) {
        return [{ id: generateGuid(), kind: 'quote', refGuid: p.entityGuid }]
      }
      if (p.kind === 'memo' && p.entityGuid) {
        return [{ id: generateGuid(), kind: 'memo', refGuid: p.entityGuid }]
      }
    } catch { /* ignore */ }
  }
  return []
}

/** True when a drag carries something this tool accepts. */
function isAcceptedDrag(e: React.DragEvent): boolean {
  const t = e.dataTransfer.types
  return (
    t.includes(BLOCK_MIME) ||
    t.includes(REORDER_MIME) ||
    t.includes('application/x-magnolia-query') ||
    t.includes('application/json')
  )
}

export function Reports({ savedConfig, inTab }: Props) {
  const [title, setTitle] = useState<string>(savedConfig?.title ?? '')
  const [items, setItems] = useState<ReportItem[]>(savedConfig?.items ?? [])
  const [analysisGuid] = useState(savedConfig?.guid ?? generateGuid())
  const [analysisName, setAnalysisName] = useState(savedConfig?.name ?? '')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const isExisting = !!savedConfig?.guid

  // Live store reads so item cards always show current names.
  const savedQueries = useQueryStore((s) => s.savedQueries)
  const savedAnalyses = useProjectStore((s) => s.savedAnalyses)
  const quotes = useQuoteStore((s) => s.quotes)
  const memos = useMemoStore((s) => s.memos)
  // Subscribe so labels recompute when the referenced entities change.
  void savedQueries; void savedAnalyses; void quotes; void memos

  const currentConfig = useMemo(() => ({ title, items }), [title, items])
  const initialBaseline = useMemo(
    () => ({ title: savedConfig?.title ?? '', items: savedConfig?.items ?? [] }),
    []
  )
  const { dirty, baseline, setBaseline } = useToolDirtyState(currentConfig, initialBaseline, inTab)

  const insertItemsAt = useCallback((index: number, newItems: ReportItem[]) => {
    if (newItems.length === 0) return
    setItems((prev) => {
      const next = [...prev]
      next.splice(Math.max(0, Math.min(index, next.length)), 0, ...newItems)
      return next
    })
  }, [])

  const moveItem = useCallback((id: string, index: number) => {
    setItems((prev) => {
      const from = prev.findIndex((it) => it.id === id)
      if (from === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      const adjusted = from < index ? index - 1 : index
      next.splice(Math.max(0, Math.min(adjusted, next.length)), 0, moved)
      return next
    })
  }, [])

  const handleDropAt = useCallback((index: number, e: React.DragEvent) => {
    e.preventDefault()
    setDragOverIdx(null)
    const reorderId = e.dataTransfer.getData(REORDER_MIME)
    if (reorderId) {
      moveItem(reorderId, index)
      return
    }
    insertItemsAt(index, parseDrop(e))
  }, [insertItemsAt, moveItem])

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [])

  const updateItem = useCallback((id: string, patch: Partial<ReportItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? ({ ...it, ...patch } as ReportItem) : it)))
  }, [])

  const setAnalysisOption = useCallback((id: string, key: keyof AnalysisItemOptions, value: boolean) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.kind === 'analysis'
          ? { ...it, options: { ...it.options, [key]: value } }
          : it
      )
    )
  }, [])

  const handleSave = useCallback((name: string) => {
    setAnalysisName(name)
    setShowSaveDialog(false)
    window.api.sendAnalysisAction('save-analysis', {
      guid: analysisGuid,
      toolType: 'reports',
      name,
      config: { title, items }
    })
    setBaseline({ title, items })
    if (inTab) inTab.onSaved(analysisGuid, name)
    else setTimeout(() => window.close(), 200)
  }, [analysisGuid, title, items, inTab, setBaseline])

  const handleRename = useCallback((newName: string) => {
    setAnalysisName(newName)
    renameSavedAnalysis(analysisGuid, newName)
    if (inTab) inTab.onSaved('', newName)
  }, [analysisGuid, inTab])

  const handleDiscard = useCallback(() => {
    setTitle(baseline.title)
    setItems(baseline.items)
  }, [baseline])

  useRegisterToolSave(inTab?.tabId, () => {
    if (isExisting) {
      handleSave(analysisName)
      return true
    }
    setShowSaveDialog(true)
    return false
  })

  const [exporting, setExporting] = useState(false)
  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      await exportReportPdf(title, items)
    } finally {
      setExporting(false)
    }
  }, [title, items])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Title row + actions */}
      <div style={{ padding: '14px 20px 6px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
          <Icon icon={faClipboardList} className="analysis-header-icon" style={{ fontSize: 16 }} />
          Report{isExisting ? ':' : ''}
          {isExisting && <EditableTitleSuffix name={analysisName} onRename={handleRename} />}
        </h2>
        <div style={{ flex: 1 }} />
        <button className="secondary" style={{ fontSize: 11, padding: '4px 14px' }} onClick={() => (inTab ? inTab.onClose() : window.close())}>
          Close
        </button>
        {isExisting && dirty && (
          <button className="secondary" style={{ fontSize: 11, padding: '4px 14px' }} onClick={handleDiscard}>
            Discard Changes
          </button>
        )}
        <button className="secondary" style={{ fontSize: 11, padding: '4px 14px' }} disabled={exporting} onClick={handleExport}>
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
        {isExisting ? (
          <button style={{ fontSize: 11, padding: '4px 14px' }} disabled={!dirty} onClick={() => handleSave(analysisName)}>
            {dirty ? 'Update Report' : 'Saved'}
          </button>
        ) : (
          <button style={{ fontSize: 11, padding: '4px 14px' }} onClick={() => setShowSaveDialog(true)}>
            Save Report
          </button>
        )}
        <div style={{ width: 36, flexShrink: 0 }} />
      </div>

      {/* Tool toolbar: draggable Section / Text blocks. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-panel)', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>Drag in:</span>
        <PaletteChip block="section" icon={faHeading1} label="Section" />
        <PaletteChip block="text" icon={faFont} label="Text" />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>…or drag Saved Queries, Analyses, Quotes &amp; Memos from the panels</span>
      </div>

      {/* The report list */}
      <div
        style={{ flex: 1, overflow: 'auto', padding: '14px 20px' }}
        onDragOver={(e) => { if (isAcceptedDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
        onDrop={(e) => handleDropAt(items.length, e)}
      >
        {/* Report title — always the first list item. */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 4 }}>Report title</label>
          <input
            type="text"
            value={title}
            placeholder="Untitled report"
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%', maxWidth: 520, fontSize: 16, fontWeight: 600, padding: '6px 10px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          />
        </div>

        {items.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
            Drag Saved Queries, Analyses, Quotes, or Memos here — or drop a Section / Text block from the toolbar — to build the report.
          </div>
        ) : (
          <div>
            {items.map((item, idx) => (
              <div key={item.id}>
                {/* Drop indicator before this row. */}
                <div
                  onDragOver={(e) => { if (isAcceptedDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverIdx(idx) } }}
                  onDragLeave={() => setDragOverIdx((c) => (c === idx ? null : c))}
                  onDrop={(e) => handleDropAt(idx, e)}
                  style={{ height: 8, borderRadius: 2, background: dragOverIdx === idx ? 'var(--accent)' : 'transparent' }}
                />
                <ReportRow
                  item={item}
                  label={resolveItemLabel(item)}
                  onRemove={() => removeItem(item.id)}
                  onUpdate={(patch) => updateItem(item.id, patch)}
                  onSetOption={(key, value) => setAnalysisOption(item.id, key, value)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save dialog */}
      {showSaveDialog && (
        <div className="modal-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Save Report</h2>
            <input
              autoFocus
              type="text"
              defaultValue={analysisName || title}
              placeholder="Report name"
              style={{ width: '100%' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave((e.target as HTMLInputElement).value.trim() || 'Untitled Report')
                if (e.key === 'Escape') setShowSaveDialog(false)
              }}
            />
            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button onClick={(e) => {
                const input = (e.target as HTMLElement).parentElement!.parentElement!.querySelector('input') as HTMLInputElement
                handleSave(input.value.trim() || 'Untitled Report')
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PaletteChip({ block, icon, label }: { block: 'section' | 'text'; icon: typeof faHeading1; label: string }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(BLOCK_MIME, block)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      title={`Drag onto the list to add a ${label.toLowerCase()}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '3px 10px', cursor: 'grab' }}
    >
      <Icon icon={icon} style={{ fontSize: 11, color: 'var(--text-muted)' }} />
      {label}
    </div>
  )
}

function ReportRow({
  item,
  label,
  onRemove,
  onUpdate,
  onSetOption
}: {
  item: ReportItem
  label: string
  onRemove: () => void
  onUpdate: (patch: Partial<ReportItem>) => void
  onSetOption: (key: keyof AnalysisItemOptions, value: boolean) => void
}) {
  const caps = item.kind === 'analysis' ? ANALYSIS_CAPS[item.toolType] ?? {} : {}
  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', marginBottom: 2, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          draggable
          onDragStart={(e) => { e.dataTransfer.setData(REORDER_MIME, item.id); e.dataTransfer.effectAllowed = 'move' }}
          title="Drag to reorder"
          style={{ cursor: 'grab', color: 'var(--text-muted)', flexShrink: 0, display: 'inline-flex' }}
        >
          <Icon icon={faBars} style={{ fontSize: 12 }} />
        </span>
        <Icon icon={itemIcon(item)} style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', flexShrink: 0 }}>{reportItemTypeLabel(item)}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.kind !== 'section' && item.kind !== 'text' ? label : ''}
        </span>
        <span onClick={onRemove} title="Remove" style={{ cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0, display: 'inline-flex' }}>
          <Icon icon={faXmark} style={{ fontSize: 12 }} />
        </span>
      </div>

      {/* Section: editable heading text. */}
      {item.kind === 'section' && (
        <input
          type="text"
          value={item.title}
          placeholder="Section heading"
          onChange={(e) => onUpdate({ title: e.target.value })}
          style={{ width: '100%', marginTop: 8, fontSize: 14, fontWeight: 600, padding: '5px 8px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
        />
      )}

      {/* Text: inline rich-text editor (stored as markdown). */}
      {item.kind === 'text' && (
        <div style={{ marginTop: 8 }}>
          <MarkdownEditor value={item.content} onChange={(md) => onUpdate({ content: md })} style={{ minHeight: 90 }} />
        </div>
      )}

      {/* Analysis: display options. */}
      {item.kind === 'analysis' && (caps.totalsOnly || caps.binary || caps.visual) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, paddingLeft: 28, flexWrap: 'wrap' }}>
          {caps.totalsOnly && (
            <OptionToggle label="Totals only" checked={!!item.options.totalsOnly} onChange={(v) => onSetOption('totalsOnly', v)} />
          )}
          {caps.binary && (
            <OptionToggle label="Binary" checked={!!item.options.binary} onChange={(v) => onSetOption('binary', v)} />
          )}
          {caps.visual && (
            <OptionToggle label="Visual" checked={!!item.options.visual} onChange={(v) => onSetOption('visual', v)} />
          )}
        </div>
      )}
    </div>
  )
}

function OptionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
