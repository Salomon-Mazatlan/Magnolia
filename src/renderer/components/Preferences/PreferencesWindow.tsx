/**
 * PreferencesWindow — user settings, two-column layout. Categories on the
 * left, the selected category's settings on the right. Categories today
 * are Appearance (theme) and Media Playback (foot-pedal mappings + speed).
 *
 * Hosted as a tab in the main window (renders inside DocumentViewer's
 * tool-tab slot) and historically also as a standalone popout window
 * via preferences-entry.tsx. The optional `onClose` callback lets the
 * tab host close the tab; if absent (popout mode) we fall back to
 * `window.close()`.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Icon, faGear } from '../Icon'

interface FootPedalMappings {
  playPause: string
  rewind: string
  fastForward: string
  rewindSeconds: number
  fastForwardSeconds: number
}

type ThemeId = '' | 'dark' | 'granola' | 'granola-dark' | 'high-contrast' | 'magnolia' | 'magnolia-dark'

interface Preferences {
  footPedalMappings: FootPedalMappings
  defaultPlaybackSpeed: number
  theme: ThemeId
}

const DEFAULT_PREFS: Preferences = {
  footPedalMappings: {
    playPause: 'F5',
    rewind: 'F6',
    fastForward: 'F7',
    rewindSeconds: 5,
    fastForwardSeconds: 5
  },
  defaultPlaybackSpeed: 1.0,
  // Magnolia is the default for new installs (Lab Dark when the OS
  // reports prefers-color-scheme: dark — handled by apply-theme.ts
  // on first paint). Existing pref files that already carry a saved
  // theme (including the legacy '' for Clean) override this.
  theme: 'magnolia'
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

interface ThemeOption {
  id: ThemeId
  label: string
  /** Three swatch colors used to render a small preview of the palette. */
  swatch: { bg: string; surface: string; accent: string }
}

const THEME_OPTIONS: ThemeOption[] = [
  { id: 'magnolia',      label: 'Magnolia',      swatch: { bg: '#C8D0DA', surface: '#FFFFFF', accent: '#2563EB' } },
  { id: 'magnolia-dark', label: 'Magnolia Dark', swatch: { bg: '#14181E', surface: '#252B35', accent: '#5B8FFF' } },
  { id: 'granola',       label: 'Granola',       swatch: { bg: '#f1e6cf', surface: '#ffffff', accent: '#c97134' } },
  { id: 'granola-dark',  label: 'Granola Dark',  swatch: { bg: '#1f1a14', surface: '#2d271f', accent: '#e08a4a' } },
  { id: '',              label: 'Clean',         swatch: { bg: '#ffffff', surface: '#ececec', accent: '#007AFF' } },
  { id: 'dark',          label: 'Clean Dark',    swatch: { bg: '#1e1e2e', surface: '#2a2a3c', accent: '#0a84ff' } },
  { id: 'high-contrast', label: 'High Contrast', swatch: { bg: '#000000', surface: '#ffffff', accent: '#ffff00' } }
]

type CategoryId = 'appearance' | 'media-playback'

interface Category {
  id: CategoryId
  label: string
}

const CATEGORIES: Category[] = [
  { id: 'appearance',     label: 'Appearance' },
  { id: 'media-playback', label: 'Media Playback' }
]

/** Capture a key combination from a keyboard event */
function keyComboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Cmd')

  const key = e.key
  // Skip modifier-only presses
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return ''

  // Normalize key names
  const normalized = key.length === 1 ? key.toUpperCase() : key
  parts.push(normalized)
  return parts.join('+')
}

function KeyCaptureInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [capturing, setCapturing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!capturing) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const combo = keyComboFromEvent(e)
      if (combo) {
        onChange(combo)
        setCapturing(false)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [capturing, onChange])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <label style={{ width: 120, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</label>
      <input
        ref={inputRef}
        readOnly
        value={capturing ? 'Press a key...' : value}
        onClick={() => setCapturing(true)}
        onBlur={() => setCapturing(false)}
        style={{
          flex: 1,
          padding: '4px 8px',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          border: `1px solid ${capturing ? 'var(--accent)' : 'var(--border-color)'}`,
          borderRadius: 'var(--radius-sm)',
          background: capturing ? 'var(--selection-bg)' : 'var(--bg-primary)',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          outline: 'none',
          textAlign: 'center'
        }}
      />
    </div>
  )
}

function AppearanceSettings({ value, onChange }: { value: ThemeId; onChange: (v: ThemeId) => void }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--text-secondary)' }}>Theme</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {THEME_OPTIONS.map((opt) => {
          const selected = opt.id === value
          return (
            <div
              key={opt.id || 'clean'}
              onClick={() => onChange(opt.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 10px',
                border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-color)'}`,
                borderRadius: 'var(--radius-md)',
                // Unselected rows match the toolbar surface (--bg-secondary)
                // rather than the deeper page chrome (--bg-primary), so the
                // theme cards read as "lifted UI" instead of "filled with
                // chrome". Selected stays on --selection-bg to keep the
                // active card visually distinct.
                background: selected ? 'var(--selection-bg)' : 'var(--bg-secondary)',
                cursor: 'pointer',
                transition: 'background 0.12s, border-color 0.12s'
              }}
            >
              {/* Swatch — three stacked colors */}
              <div style={{
                width: 44, height: 28, flexShrink: 0,
                borderRadius: 4, overflow: 'hidden',
                border: '1px solid var(--border-color)',
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr'
              }}>
                <div style={{ background: opt.swatch.bg }} />
                <div style={{ background: opt.swatch.surface }} />
                <div style={{ background: opt.swatch.accent }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {opt.label}
                  {opt.id === 'magnolia' && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500, marginLeft: 6 }}>(default)</span>
                  )}
                </div>
              </div>
              {selected && (
                <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>✓</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MediaPlaybackSettings({
  prefs,
  updateMapping,
  save
}: {
  prefs: Preferences
  updateMapping: (key: keyof FootPedalMappings, value: string | number) => void
  save: (updated: Preferences) => void
}) {
  return (
    <>
      {/* Foot Pedal / Key Mappings */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-secondary)' }}>
          Audio Playback Key Mappings
        </h3>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          Map keyboard keys or foot pedal buttons to audio playback controls.
          Click an input field and press the desired key combination.
        </p>
        <KeyCaptureInput
          label="Play / Pause"
          value={prefs.footPedalMappings.playPause}
          onChange={(v) => updateMapping('playPause', v)}
        />
        <KeyCaptureInput
          label="Rewind"
          value={prefs.footPedalMappings.rewind}
          onChange={(v) => updateMapping('rewind', v)}
        />
        <KeyCaptureInput
          label="Fast Forward"
          value={prefs.footPedalMappings.fastForward}
          onChange={(v) => updateMapping('fastForward', v)}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 12 }}>
          <label style={{ width: 120, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Rewind seconds</label>
          <input
            type="number"
            min={1}
            max={60}
            value={prefs.footPedalMappings.rewindSeconds}
            onChange={(e) => updateMapping('rewindSeconds', parseInt(e.target.value) || 5)}
            style={{
              width: 60, padding: '4px 8px', fontSize: 12,
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-input)', color: 'var(--text-primary)', textAlign: 'center'
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <label style={{ width: 120, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Forward seconds</label>
          <input
            type="number"
            min={1}
            max={60}
            value={prefs.footPedalMappings.fastForwardSeconds}
            onChange={(e) => updateMapping('fastForwardSeconds', parseInt(e.target.value) || 5)}
            style={{
              width: 60, padding: '4px 8px', fontSize: 12,
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-input)', color: 'var(--text-primary)', textAlign: 'center'
            }}
          />
        </div>
      </div>

      {/* Default playback speed */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-secondary)' }}>Default Playback Speed</h3>
        <select
          value={prefs.defaultPlaybackSpeed}
          onChange={(e) => save({ ...prefs, defaultPlaybackSpeed: parseFloat(e.target.value) })}
          style={{
            padding: '4px 8px', fontSize: 12,
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-input)', color: 'var(--text-primary)', cursor: 'pointer'
          }}
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>
      </div>
    </>
  )
}

interface PreferencesWindowProps {
  /** Tab-host close callback. When present, the Close button calls
   *  this; otherwise (popout-window mode) it falls back to window.close. */
  onClose?: () => void
}

export function PreferencesWindow({ onClose }: PreferencesWindowProps = {}) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS)
  const [loaded, setLoaded] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>(CATEGORIES[0].id)

  // Load preferences on mount
  useEffect(() => {
    let cancelled = false

    // Preferences live in the main-window tab now (toolbar wordmark →
    // openToolTab). Read once from disk on mount; the previous
    // popped-out window's staged-init / on-refocus paths are gone.
    ;(async () => {
      const data = await window.api.loadPreferences()
      if (cancelled) return
      if (data) {
        setPrefs({
          ...DEFAULT_PREFS,
          ...data,
          theme: (data.theme ?? DEFAULT_PREFS.theme) as ThemeId,
          footPedalMappings: { ...DEFAULT_PREFS.footPedalMappings, ...(data.footPedalMappings || {}) }
        })
      }
      setLoaded(true)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback((updated: Preferences) => {
    setPrefs(updated)
    window.api.savePreferences(updated)
    window.api.sendPreferencesUpdate(updated)
  }, [])

  const updateMapping = useCallback((key: keyof FootPedalMappings, value: string | number) => {
    const updated = { ...prefs, footPedalMappings: { ...prefs.footPedalMappings, [key]: value } }
    save(updated)
  }, [prefs, save])

  const setTheme = useCallback((theme: ThemeId) => {
    const updated = { ...prefs, theme }
    save(updated)
    // Apply locally and broadcast so every other open window updates too.
    document.documentElement.setAttribute('data-theme', theme)
    window.api.broadcastTheme(theme)
  }, [prefs, save])

  if (!loaded) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading...</div>

  const selected = CATEGORIES.find((c) => c.id === selectedCategory) ?? CATEGORIES[0]

  return (
    <div
      className="preferences-window"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'var(--font-family)',
        fontSize: 'var(--font-size-base)',
        color: 'var(--text-primary)',
        // Inherit the panel surface so the tab matches the analysis
        // tools / query builder / relationships tab.
        overflow: 'hidden'
      }}
    >
      {/* Title row — mirrors the analysis-tools pattern: padding,
          h2 with leading icon, flex spacer, Close button. */}
      <div style={{ padding: '14px 20px 6px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
          <Icon icon={faGear} className="analysis-header-icon" style={{ fontSize: 16 }} />
          Preferences
        </h2>
        <div style={{ flex: 1 }} />
        <button
          className="secondary"
          style={{ fontSize: 11, padding: '4px 14px' }}
          onClick={() => (onClose ? onClose() : window.close())}
        >
          Close
        </button>
      </div>

      {/* Body — two-column layout (categories sidebar + selected
          category's settings). Fills remaining height. */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Categories sidebar */}
        <div style={{
          width: 180,
          flexShrink: 0,
          borderRight: '1px solid var(--border-color)',
          padding: '8px 0',
          overflow: 'auto'
        }}>
          {CATEGORIES.map((cat) => {
            const active = cat.id === selectedCategory
            return (
              <div
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                style={{
                  padding: '6px 20px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: active ? 'var(--selection-bg)' : 'transparent',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                {cat.label}
              </div>
            )
          })}
        </div>

        {/* Selected category's settings */}
        <div style={{ flex: 1, padding: '14px 20px', overflow: 'auto' }}>
          {selected.id === 'appearance' && (
            <AppearanceSettings value={prefs.theme} onChange={setTheme} />
          )}
          {selected.id === 'media-playback' && (
            <MediaPlaybackSettings prefs={prefs} updateMapping={updateMapping} save={save} />
          )}
        </div>
      </div>
    </div>
  )
}
