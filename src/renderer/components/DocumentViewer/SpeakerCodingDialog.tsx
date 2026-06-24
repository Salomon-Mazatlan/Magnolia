import { useEffect, useMemo, useRef, useState } from 'react'
import type { DetectedSpeaker } from '../../utils/transcript-speakers'

const PRESET_COLORS = [
  '#e05050', '#e08050', '#e0c050', '#50c050', '#50c0c0',
  '#5080e0', '#8050e0', '#e050a0', '#c07030', '#7070e0'
]

/** Seconds of audio the play button previews. */
const CLIP_SECONDS = 5

/** A speaker's chosen code: an existing one (dragged in) or a new one to be
 *  created on Apply. */
type Assignment =
  | { kind: 'existing'; guid: string; name: string; color?: string }
  | { kind: 'new'; name: string; color: string }

export interface SpeakerAssignment {
  speakerId: string
  /** An existing code's guid, or null when a new code should be created. */
  codeGuid: string | null
  /** For a new code: its name + color (codeGuid is null). */
  newCode?: { name: string; color: string }
  ranges: { startChar: number; endChar: number }[]
}

interface Props {
  open: boolean
  speakers: DetectedSpeaker[]
  /** The audio/video source the transcript was imported into. */
  source: { guid: string; sourceType?: string; formatData?: any; name?: string } | undefined
  onApply: (assignments: SpeakerAssignment[]) => void
  onClose: () => void
}

export function SpeakerCodingDialog({ open, speakers, source, onApply, onClose }: Props) {
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({})
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [editingNew, setEditingNew] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)

  // Reset when the dialog (re)opens for a fresh import.
  useEffect(() => {
    if (open) {
      setAssignments({})
      setEditingNew(null)
      setPlayingId(null)
    }
  }, [open, speakers])

  // ── Media for the preview clips ───────────────────────────────────────────
  const mediaHandle: string | undefined =
    source?.sourceType === 'video' ? source?.formatData?.videoFilePath : source?.formatData?.audioFilePath
  const mimeType: string = source?.formatData?.mimeType || (source?.sourceType === 'video' ? 'video/mp4' : 'audio/mpeg')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stopAtRef = useRef<number>(Infinity)
  const [mediaUrl, setMediaUrl] = useState('')

  useEffect(() => {
    if (!open || !mediaHandle) return
    let revoke: string | null = null
    let cancelled = false
    const read = source?.sourceType === 'video' ? window.api.readVideoFile : window.api.readAudioFile
    read(mediaHandle)
      .then((buffer: ArrayBuffer) => {
        if (cancelled) return
        const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }))
        revoke = url
        setMediaUrl(url)
      })
      .catch((err: unknown) => console.error('Speaker preview: failed to load media:', err))
    return () => {
      cancelled = true
      if (revoke) URL.revokeObjectURL(revoke)
      setMediaUrl('')
    }
  }, [open, mediaHandle, mimeType, source?.sourceType])

  const playPreview = (sp: DetectedSpeaker) => {
    const a = audioRef.current
    if (!a) return
    if (playingId === sp.id && !a.paused) { a.pause(); return }
    const stopAt = sp.previewEnd > sp.previewStart
      ? Math.min(sp.previewStart + CLIP_SECONDS, sp.previewEnd)
      : sp.previewStart + CLIP_SECONDS
    stopAtRef.current = stopAt
    const start = () => {
      a.currentTime = Math.max(0, sp.previewStart)
      a.play().then(() => setPlayingId(sp.id)).catch(() => setPlayingId(null))
    }
    if (a.readyState < 1) a.addEventListener('loadedmetadata', start, { once: true })
    else start()
  }

  const onTimeUpdate = () => {
    const a = audioRef.current
    if (a && a.currentTime >= stopAtRef.current) {
      a.pause()
      stopAtRef.current = Infinity
    }
  }

  // ── Code assignment via drag-and-drop ─────────────────────────────────────
  const handleDrop = (speakerId: string, e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    const raw =
      e.dataTransfer.getData('application/x-magnolia-code') ||
      e.dataTransfer.getData('application/x-magnolia-codes')
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      const code = Array.isArray(parsed) ? parsed[0] : parsed
      if (code?.guid) {
        setAssignments((a) => ({ ...a, [speakerId]: { kind: 'existing', guid: code.guid, name: code.name, color: code.color } }))
        setEditingNew(null)
      }
    } catch { /* ignore malformed drag data */ }
  }

  const acceptsCode = (e: React.DragEvent) =>
    e.dataTransfer.types.includes('application/x-magnolia-code') ||
    e.dataTransfer.types.includes('application/x-magnolia-codes')

  const startNewCode = (speakerId: string) => {
    setNewName(speakerId)
    setEditingNew(speakerId)
  }
  const confirmNewCode = (speakerId: string, index: number) => {
    const name = newName.trim()
    if (!name) { setEditingNew(null); return }
    setAssignments((a) => ({ ...a, [speakerId]: { kind: 'new', name, color: PRESET_COLORS[index % PRESET_COLORS.length] } }))
    setEditingNew(null)
  }
  const clearAssignment = (speakerId: string) =>
    setAssignments((a) => { const next = { ...a }; delete next[speakerId]; return next })

  const assignedCount = Object.keys(assignments).length

  const handleApply = () => {
    const byId = new Map(speakers.map((s) => [s.id, s]))
    const out: SpeakerAssignment[] = []
    for (const [speakerId, asn] of Object.entries(assignments)) {
      const sp = byId.get(speakerId)
      if (!sp) continue
      out.push({
        speakerId,
        codeGuid: asn.kind === 'existing' ? asn.guid : null,
        newCode: asn.kind === 'new' ? { name: asn.name, color: asn.color } : undefined,
        ranges: sp.ranges
      })
    }
    onApply(out)
  }

  const title = useMemo(
    () => `${speakers.length} speaker${speakers.length === 1 ? '' : 's'} detected`,
    [speakers.length]
  )

  if (!open) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ width: 560, maxWidth: '92vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md, 8px)', boxShadow: '0 10px 40px rgba(0,0,0,0.35)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px 8px' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Optionally code each speaker's lines. Drag a code from the Code Browser onto a speaker, or create a new one.
            Use ▶ to hear a {CLIP_SECONDS}-second sample and check who it is.
          </p>
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 20px', flex: 1 }}>
          {speakers.map((sp, i) => {
            const asn = assignments[sp.id]
            return (
              <div key={sp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ minWidth: 96 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{sp.id}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sp.segmentCount} segment{sp.segmentCount === 1 ? '' : 's'}</div>
                </div>

                <button
                  onClick={() => playPreview(sp)}
                  disabled={!mediaUrl}
                  title={mediaUrl ? 'Play a sample of this speaker' : 'No media attached to preview'}
                  style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: mediaUrl ? 'pointer' : 'not-allowed', flexShrink: 0, opacity: mediaUrl ? 1 : 0.5 }}
                >
                  {playingId === sp.id ? '◼' : '▶'}
                </button>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {asn ? (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', maxWidth: '100%' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: (asn.kind === 'existing' ? asn.color : asn.color) || '#888', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {asn.name}{asn.kind === 'new' ? ' (new)' : ''}
                      </span>
                      <button onClick={() => clearAssignment(sp.id)} title="Remove" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                    </div>
                  ) : editingNew === sp.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') confirmNewCode(sp.id, i); if (e.key === 'Escape') setEditingNew(null) }}
                        placeholder="New code name"
                        style={{ flex: 1, fontSize: 12, padding: '4px 6px', border: '1px solid var(--border-color)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                      />
                      <button onClick={() => confirmNewCode(sp.id, i)} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border-color)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}>Create</button>
                    </div>
                  ) : (
                    <div
                      onDragOver={(e) => { if (acceptsCode(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(sp.id) } }}
                      onDragLeave={() => setDragOver((d) => (d === sp.id ? null : d))}
                      onDrop={(e) => handleDrop(sp.id, e)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px', borderRadius: 6, border: `1px dashed ${dragOver === sp.id ? 'var(--accent-color, #5080e0)' : 'var(--border-color)'}`, background: dragOver === sp.id ? 'var(--bg-secondary)' : 'transparent' }}
                    >
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Drag a code here</span>
                      <button onClick={() => startNewCode(sp.id)} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border-color)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', flexShrink: 0 }}>+ New code</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border-color)' }}>
          <button onClick={onClose} style={{ fontSize: 12, padding: '6px 14px', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}>Skip</button>
          <button
            onClick={handleApply}
            disabled={assignedCount === 0}
            style={{ fontSize: 12, padding: '6px 14px', border: '1px solid var(--border-color)', borderRadius: 6, background: assignedCount === 0 ? 'var(--bg-secondary)' : 'var(--accent-color, #5080e0)', color: assignedCount === 0 ? 'var(--text-muted)' : '#fff', cursor: assignedCount === 0 ? 'not-allowed' : 'pointer' }}
          >
            Code {assignedCount > 0 ? `${assignedCount} speaker${assignedCount === 1 ? '' : 's'}` : 'speakers'}
          </button>
        </div>

        {mediaUrl && (
          <audio ref={audioRef} src={mediaUrl} onTimeUpdate={onTimeUpdate} onPause={() => setPlayingId(null)} onEnded={() => setPlayingId(null)} style={{ display: 'none' }} />
        )}
      </div>
    </div>
  )
}
