/**
 * AnalysisPopover — single "Analysis ▾" toolbar button that opens a
 * tile-grid popover listing every analysis tool. Replaces the previous
 * row of seven inline analysis-tool buttons (Codes in Docs / Results
 * in Docs / Co-Occurrences / Code Freq. / Code Orders / Word Freq. /
 * Relationships) so the top toolbar can give its remaining slots to
 * tools the user reaches for daily.
 *
 * The button is a controlled-style internal-state component: it
 * tracks open/closed itself, closes on outside-click + Escape +
 * tile-click, and calls `onSelect(toolType)` so the host (App.tsx)
 * routes to the right `openAnalysis(...)` flow.
 */
import { useState, useEffect, useRef } from 'react'
import { Icon, faLightbulb, type IconComponent } from '../Icon'
import type { AnalysisToolType } from '../../models/types'
import { TOOL_REGISTRY } from '../../utils/tool-registry'

/** Tools the popover surfaces, in the order they appear in the grid.
 *  Query Builder is intentionally NOT in this list — it stays on the
 *  top toolbar as a primary action. */
const ANALYSIS_TOOL_ORDER: AnalysisToolType[] = [
  'codes-in-documents',
  'results-in-documents',
  'code-cooccurrences',
  'code-orders',
  'code-frequencies',
  'word-frequencies',
  'relationship-map'
]

interface Props {
  onSelect: (toolType: AnalysisToolType) => void
}

export function AnalysisPopover({ onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on outside-click + Escape. Only attached while open so the
  // listeners stay off until needed.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleSelect = (toolType: AnalysisToolType) => {
    onSelect(toolType)
    setOpen(false)
  }

  return (
    <div className="analysis-popover-anchor">
      <button
        ref={buttonRef}
        type="button"
        className="app-toolbar-btn"
        title="Analysis tools"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          padding: '4px 12px',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          cursor: 'pointer',
          lineHeight: 1,
          transition: 'background 0.12s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)';
          (e.currentTarget.querySelector('.toolbar-label') as HTMLElement).style.color = 'var(--text-primary)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          (e.currentTarget.querySelector('.toolbar-label') as HTMLElement).style.color = 'var(--text-secondary)'
        }}
      >
        <Icon icon={faLightbulb} style={{ fontSize: 20 }} />
        <span className="toolbar-label" style={{ fontSize: 9, whiteSpace: 'nowrap', fontWeight: 400, color: 'var(--text-secondary)', transition: 'color 0.12s' }}>Analyse</span>
      </button>

      {open && (
        <div ref={popoverRef} className="analysis-popover" role="menu">
          <div className="analysis-popover-arrow" />
          <div className="analysis-popover-title">Analysis tools</div>
          <div className="analysis-popover-grid">
            {ANALYSIS_TOOL_ORDER.map((toolType) => {
              const def = TOOL_REGISTRY[toolType]
              if (!def) return null
              const ToolIcon: IconComponent = def.icon
              return (
                <button
                  key={toolType}
                  type="button"
                  role="menuitem"
                  className="analysis-popover-tile"
                  onClick={() => handleSelect(toolType)}
                >
                  <Icon icon={ToolIcon} style={{ fontSize: 14 }} />
                  <div className="analysis-popover-tile-name">{def.label}</div>
                  {def.description && (
                    <div className="analysis-popover-tile-desc">{def.description}</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
