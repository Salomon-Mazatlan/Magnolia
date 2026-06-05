import { create } from 'zustand'
import type {
  MapElement,
  FreeTextElement,
  MapConnection,
  RelationshipMapConfig
} from '../components/Analysis/RelationshipMap/types'
import { generateGuid } from '../utils/guid'
import { makeHmrSafe } from './hmr-preserve'

export interface MapSnapshot {
  elements: MapElement[]
  freeTexts: FreeTextElement[]
  connections: MapConnection[]
  pan: { x: number; y: number }
}

export interface MapInstance {
  guid: string
  name: string
  elements: MapElement[]
  freeTexts: FreeTextElement[]
  connections: MapConnection[]
  pan: { x: number; y: number }
  zoom: number
  /** Dirty since last explicit save — drives the unsaved-changes
   *  marker, the disabled state of the Save button, and the
   *  confirm-on-close dialog. Saves are explicit only; there is no
   *  autosave for relationship maps. */
  dirty: boolean
  /** Snapshot of the last persisted state. Updated on `markSaved` and
   *  consumed by `revertToSnapshot` (Discard Changes). */
  lastSavedSnapshot: MapSnapshot
  /** True while the map is being edited in a popped-out window instead of
   *  inline as a tab. The inline tab content is hidden in this state; the
   *  tab strip entry is removed entirely until the window closes. */
  poppedOut: boolean
}

interface State {
  /** Every map the user has opened (inline or popped-out) keyed by guid. */
  maps: Record<string, MapInstance>

  /** Create a new empty map and return its guid. */
  createNewMap: (name?: string) => string

  /** Load a saved map into the store. If a map with that guid already
   *  exists, its in-memory state is preserved (the user may have in-flight
   *  edits); otherwise it is seeded from the saved config. */
  loadSavedMap: (guid: string, name: string, config: RelationshipMapConfig) => void

  setName: (guid: string, name: string) => void
  setElements: (guid: string, elements: MapElement[]) => void
  setFreeTexts: (guid: string, freeTexts: FreeTextElement[]) => void
  setConnections: (guid: string, connections: MapConnection[]) => void
  setPan: (guid: string, pan: { x: number; y: number }) => void
  setZoom: (guid: string, zoom: number) => void
  /** Update one element's measured height without marking the map dirty.
   *  ResizeObserver-driven layout corrections (which fire whenever the
   *  tab goes display:none → display:flex on a tab switch) would
   *  otherwise re-mark a freshly-saved map as dirty for no semantic
   *  reason. */
  updateElementHeight: (guid: string, elementId: string, height: number) => void

  /** Mark the map as saved: clear dirty + snapshot the current canvas
   *  state so a subsequent Discard reverts to *this* point. */
  markSaved: (guid: string) => void
  /** Revert canvas state to the last-saved snapshot and clear dirty.
   *  Used by the Discard Changes button on existing maps. */
  revertToSnapshot: (guid: string) => void
  setPoppedOut: (guid: string, poppedOut: boolean) => void

  /** Drop a map from memory (used when its tab is closed and it's not
   *  popped out). */
  removeMap: (guid: string) => void

  /** Drop every map. Called on project switch / new project so a map from
   *  the previous project doesn't linger and bleed into the new one via
   *  its preserved "map:" tab. */
  clearAll: () => void

  /** Sweep every map: remove memo-kind elements whose entityGuid matches
   *  the given memo guid, and clear memoGuid on any element attached to
   *  it. Called when a memo is deleted from the Memos pane so dangling
   *  canvas boxes and paperclip badges disappear immediately. */
  detachMemo: (memoGuid: string) => void
}

function updateMap(
  state: State,
  guid: string,
  patch: Partial<MapInstance>,
  markDirty = true
): Partial<State> {
  const existing = state.maps[guid]
  if (!existing) return {}
  return {
    maps: {
      ...state.maps,
      [guid]: { ...existing, ...patch, dirty: markDirty ? true : existing.dirty }
    }
  }
}

export const useRelationshipMapStore = create<State>((set, _get) => ({
  maps: {},

  createNewMap: (name) => {
    const guid = generateGuid()
    const emptySnapshot: MapSnapshot = {
      elements: [],
      freeTexts: [],
      connections: [],
      pan: { x: 0, y: 0 }
    }
    const instance: MapInstance = {
      guid,
      name: name ?? '',
      ...emptySnapshot,
      zoom: 1,
      dirty: false,
      lastSavedSnapshot: emptySnapshot,
      poppedOut: false
    }
    set((s) => ({ maps: { ...s.maps, [guid]: instance } }))
    return guid
  },

  loadSavedMap: (guid, name, config) => {
    set((s) => {
      if (s.maps[guid]) return s
      const snapshot: MapSnapshot = {
        elements: config.elements ?? [],
        freeTexts: config.freeTexts ?? [],
        connections: config.connections ?? [],
        pan: config.pan ?? { x: 0, y: 0 }
      }
      const instance: MapInstance = {
        guid,
        name,
        ...snapshot,
        zoom: 1,
        dirty: false,
        lastSavedSnapshot: snapshot,
        poppedOut: false
      }
      return { maps: { ...s.maps, [guid]: instance } }
    })
  },

  setName: (guid, name) => set((s) => updateMap(s, guid, { name })),
  setElements: (guid, elements) => set((s) => updateMap(s, guid, { elements })),
  setFreeTexts: (guid, freeTexts) => set((s) => updateMap(s, guid, { freeTexts })),
  setConnections: (guid, connections) => set((s) => updateMap(s, guid, { connections })),
  setPan: (guid, pan) => set((s) => updateMap(s, guid, { pan })),
  setZoom: (guid, zoom) => set((s) => updateMap(s, guid, { zoom }, false)),

  updateElementHeight: (guid, elementId, height) =>
    set((s) => {
      const existing = s.maps[guid]
      if (!existing) return s
      let changed = false
      const nextElements = existing.elements.map((el) => {
        if (el.id !== elementId || el.height === height) return el
        changed = true
        return { ...el, height }
      })
      if (!changed) return s
      // Mirror the height change into lastSavedSnapshot so a later
      // Discard doesn't snap the box back to a stale measured height.
      const nextSnapshot: MapSnapshot = {
        ...existing.lastSavedSnapshot,
        elements: existing.lastSavedSnapshot.elements.map((el) =>
          el.id === elementId && el.height !== height ? { ...el, height } : el
        )
      }
      return {
        maps: {
          ...s.maps,
          [guid]: { ...existing, elements: nextElements, lastSavedSnapshot: nextSnapshot }
        }
      }
    }),

  markSaved: (guid) =>
    set((s) => {
      const existing = s.maps[guid]
      if (!existing) return s
      const snapshot: MapSnapshot = {
        elements: existing.elements,
        freeTexts: existing.freeTexts,
        connections: existing.connections,
        pan: existing.pan
      }
      return {
        maps: {
          ...s.maps,
          [guid]: { ...existing, dirty: false, lastSavedSnapshot: snapshot }
        }
      }
    }),

  revertToSnapshot: (guid) =>
    set((s) => {
      const existing = s.maps[guid]
      if (!existing) return s
      return {
        maps: {
          ...s.maps,
          [guid]: { ...existing, ...existing.lastSavedSnapshot, dirty: false }
        }
      }
    }),

  setPoppedOut: (guid, poppedOut) => set((s) => updateMap(s, guid, { poppedOut }, false)),

  removeMap: (guid) =>
    set((s) => {
      if (!s.maps[guid]) return s
      const next = { ...s.maps }
      delete next[guid]
      return { maps: next }
    }),

  clearAll: () => set({ maps: {} }),

  detachMemo: (memoGuid) =>
    set((s) => {
      let anyChanged = false
      const nextMaps: Record<string, MapInstance> = {}
      for (const [guid, m] of Object.entries(s.maps)) {
        const filteredEls: MapElement[] = []
        let mapChanged = false
        for (const el of m.elements) {
          if (el.kind === 'memo' && el.entityGuid === memoGuid) {
            mapChanged = true
            continue
          }
          if (el.memoGuid === memoGuid) {
            const { memoGuid: _gone, ...rest } = el
            filteredEls.push(rest as MapElement)
            mapChanged = true
          } else {
            filteredEls.push(el)
          }
        }
        if (mapChanged) {
          anyChanged = true
          // Also drop any connections that referenced a deleted memo node.
          const stillPresent = new Set(filteredEls.map((e) => e.id))
          const filteredConns = m.connections.filter((c) => stillPresent.has(c.fromId) && stillPresent.has(c.toId))
          nextMaps[guid] = { ...m, elements: filteredEls, connections: filteredConns, dirty: true }
        } else {
          nextMaps[guid] = m
        }
      }
      return anyChanged ? { maps: nextMaps } : s
    })
}))

makeHmrSafe('relationshipMapStore', useRelationshipMapStore)
