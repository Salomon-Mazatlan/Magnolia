/**
 * StudioPopover — single "Studio" toolbar button that opens a
 * checklist popover for showing/hiding the main-window workspace
 * panels (Documents / Codes / Queries / Memos / Quotes / Analyses).
 *
 * This is the cross-platform home for what the native View menu does
 * on macOS. Windows and Linux run a frameless window with custom
 * window controls, so the native menu bar — and therefore the only
 * way to reopen a panel after closing it — is unreachable there. The
 * Studio popover gives every platform an in-window equivalent (and a
 * faster one on macOS too), mirroring the View menu's six panel
 * toggles exactly.
 *
 * Structurally a sibling of AnalysisPopover: it owns its open/closed
 * state, closes on outside-click + Escape, and reuses the shared
 * .analysis-popover container chrome. The rows stay open on click so
 * users can toggle several panels in one visit; visibility state is
 * owned by the host (App.tsx) and flows in via `panels`.
 */
import { useState, useEffect, useRef } from 'react'
import { Icon, faAppWindow, faCheck } from '../Icon'

export interface StudioPanelToggle {
  /** Stable key the host switches on in `onToggle`. */
  id: string
  label: string
  visible: boolean
}

interface Props {
  panels: StudioPanelToggle[]
  onToggle: (id: string) => void
}

export function StudioPopover({ panels, onToggle }: Props) {
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

  return (
    <div className="analysis-popover-anchor">
      <button
        ref={buttonRef}
        type="button"
        className="app-toolbar-btn"
        title="Show or hide workspace panels"
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
        <Icon icon={faAppWindow} style={{ fontSize: 20 }} />
        <span className="toolbar-label" style={{ fontSize: 9, whiteSpace: 'nowrap', fontWeight: 400, color: 'var(--text-secondary)', transition: 'color 0.12s' }}>Studio</span>
      </button>

      {open && (
        <div ref={popoverRef} className="analysis-popover studio-popover" role="menu">
          <div className="analysis-popover-arrow" />
          <div className="analysis-popover-title">Panels</div>
          <div className="studio-popover-list">
            {panels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={panel.visible}
                className="studio-popover-row"
                onClick={() => onToggle(panel.id)}
              >
                <span className="studio-popover-check" aria-hidden>
                  {panel.visible && <Icon icon={faCheck} style={{ fontSize: 13 }} />}
                </span>
                <span className="studio-popover-row-name">{panel.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
