import { useState, useRef, useEffect, type ReactNode } from 'react'

/** Shared palette for the app's colour pickers. 10 colours — a spread
 *  that covers text / highlight / code / tag needs without drowning
 *  users in choice. Extend here (not in individual pickers) when new
 *  colours are needed. */
export const COLOUR_SWATCHES: readonly string[] = [
  '#1d1d1f', // near-black (default text)
  '#6e6e6e', // grey
  '#d94a4a', // red
  '#e08050', // orange
  '#e0c050', // yellow
  '#50a050', // green
  '#40a0a0', // teal
  '#5080e0', // blue
  '#8050e0', // indigo
  '#e050a0'  // pink
]

interface Props {
  value: string | undefined
  onChange: (hex: string) => void
  disabled?: boolean
  title?: string
  /** Contents of the trigger button (typically an icon). The button's
   *  text colour is set to the current swatch value, so a Lucide icon
   *  inside (which uses currentColor) automatically reflects the
   *  chosen colour. */
  children: ReactNode
}

/** A toolbar-sized button that opens a 10-swatch grid popover. Mirrors
 *  the visual of the old "A" + colour-bar trigger but lets users pick
 *  from a curated palette instead of a full OS colour picker. */
export function ColourSwatchButton({ value, onChange, disabled, title, children }: Props) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Position the popover just below the button.
  useEffect(() => {
    if (!open) return
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    setPos({ left: r.left, top: r.bottom + 4 })
  }, [open])

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const currentColour = value || 'var(--text-primary, #1d1d1f)'

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => { if (!disabled) setOpen((o) => !o) }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3px 8px',
          borderRadius: 4,
          background: open ? 'var(--accent-bg, #e0e7ff)' : 'transparent',
          border: 'none',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.35 : 1,
          lineHeight: 1,
          fontFamily: 'inherit',
          color: currentColour
        }}
      >
        {children}
      </button>
      {open && pos && (
        <div
          ref={popRef}
          role="dialog"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            background: 'var(--bg-panel, #fff)',
            border: '1px solid var(--border-color, #e0e0e0)',
            borderRadius: 6,
            padding: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 18px)',
            gap: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            zIndex: 1000
          }}
        >
          {COLOUR_SWATCHES.map((c) => {
            const isSelected = value?.toLowerCase() === c.toLowerCase()
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c)
                  setOpen(false)
                }}
                title={c}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: c,
                  border: isSelected
                    ? '2px solid var(--accent-color, #3b82f6)'
                    : '1px solid rgba(0,0,0,0.15)',
                  cursor: 'pointer',
                  padding: 0
                }}
              />
            )
          })}
        </div>
      )}
    </>
  )
}
