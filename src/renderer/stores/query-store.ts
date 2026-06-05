import { create } from 'zustand'
import type { Query, QueryResult, SavedQuery } from '../models/types'
import { executeQuery } from '../utils/query-engine'
import { useDocumentStore } from './document-store'
import { useCodeStore } from './code-store'
import { useTagStore } from './tag-store'
import { generateGuid } from '../utils/guid'
import { useProjectStore } from './project-store'
import { makeHmrSafe } from './hmr-preserve'

interface QueryState {
  currentQuery: Query | null
  results: QueryResult[]
  isActive: boolean
  /** Names of documents referenced by the current query that no longer exist */
  missingDocuments: string[]
  savedQueries: SavedQuery[]

  setComplexQuery: (query: Query) => void
  clearQuery: () => void
  runQuery: () => void
  /** Persists `currentQuery` as a SavedQuery. The optional `guid` lets
   *  callers (typically the Query Builder) supply a client-generated
   *  identifier so they can reference the saved query immediately,
   *  before the round-tripped savedQueries change re-renders the
   *  rest of the app. Falls back to a fresh guid when omitted. */
  saveCurrentQuery: (name: string, graphLayout?: { nodes: any[]; conns: any[] }, guid?: string) => string | null
  deleteSavedQuery: (guid: string) => void
  updateSavedQuery: (guid: string, query: Query, graphLayout?: { nodes: any[]; conns: any[] }) => void
  renameSavedQuery: (guid: string, name: string) => void
  runSavedQuery: (guid: string) => void
  setSavedQueries: (queries: SavedQuery[]) => void
  clearAll: () => void
}

export const useQueryStore = create<QueryState>((set, get) => ({
  currentQuery: null,
  results: [],
  isActive: false,
  missingDocuments: [],
  savedQueries: [],

  setComplexQuery: (query) => {
    const docState = useDocumentStore.getState()
    // Check for missing documents in the query's document filter
    const missing: string[] = []
    if (query.documentFilter.sourceGuids?.length) {
      const existingGuids = new Set(docState.sources.map((s) => s.guid))
      for (const sg of query.documentFilter.sourceGuids) {
        if (!existingGuids.has(sg)) missing.push(sg)
      }
    }
    const results = executeQuery(
      query,
      docState.sources,
      docState.sourceContents,
      useCodeStore.getState().flatCodes(),
      useTagStore.getState().tags,
      docState.sourceFolder,
      docState.folders
    )
    set({ currentQuery: query, isActive: true, results, missingDocuments: missing })
  },

  clearQuery: () => set({ currentQuery: null, results: [], isActive: false, missingDocuments: [] }),

  runQuery: () => {
    const { currentQuery } = get()
    if (!currentQuery) {
      set({ results: [], missingDocuments: [] })
      return
    }
    const docState = useDocumentStore.getState()
    const missing: string[] = []
    if (currentQuery.documentFilter.sourceGuids?.length) {
      const existingGuids = new Set(docState.sources.map((s) => s.guid))
      for (const sg of currentQuery.documentFilter.sourceGuids) {
        if (!existingGuids.has(sg)) missing.push(sg)
      }
    }
    const results = executeQuery(
      currentQuery,
      docState.sources,
      docState.sourceContents,
      useCodeStore.getState().flatCodes(),
      useTagStore.getState().tags,
      docState.sourceFolder,
      docState.folders
    )
    set({ results, missingDocuments: missing })
  },

  saveCurrentQuery: (name, graphLayout, guid) => {
    const { currentQuery } = get()
    if (!currentQuery) return null
    const finalGuid = guid ?? generateGuid()
    const saved: SavedQuery = {
      guid: finalGuid,
      name,
      query: currentQuery,
      createdDateTime: new Date().toISOString(),
      graphLayout
    }
    set((state) => ({ savedQueries: [...state.savedQueries, saved] }))
    useProjectStore.getState().markDirty()
    return finalGuid
  },

  deleteSavedQuery: (guid) => {
    set((state) => ({
      savedQueries: state.savedQueries.filter((q) => q.guid !== guid)
    }))
    // Cascade: drop the saved-query memo (if any) so it doesn't
    // become an orphan invisible everywhere in the UI. Lazy import
    // breaks the circular dependency between memo-store and
    // query-store.
    import('./memo-store').then(({ useMemoStore }) => {
      const m = useMemoStore.getState().memos.find(
        (m) => m.type === 'saved-query' && m.queryGuid === guid
      )
      if (m) useMemoStore.getState().removeMemo(m.guid)
    }).catch(() => { /* ignore — tests or ssr may not have this */ })
    useProjectStore.getState().markDirty()
  },

  updateSavedQuery: (guid, query, graphLayout) => {
    set((state) => ({
      savedQueries: state.savedQueries.map((q) =>
        q.guid === guid ? { ...q, query, ...(graphLayout !== undefined ? { graphLayout } : {}) } : q
      )
    }))
    useProjectStore.getState().markDirty()
  },

  renameSavedQuery: (guid, name) => {
    set((state) => ({
      savedQueries: state.savedQueries.map((q) =>
        q.guid === guid ? { ...q, name } : q
      )
    }))
    useProjectStore.getState().markDirty()
  },

  runSavedQuery: (guid) => {
    const saved = get().savedQueries.find((q) => q.guid === guid)
    if (!saved) return
    // Use setComplexQuery which handles missing document detection
    get().setComplexQuery(saved.query)
  },

  setSavedQueries: (queries) => set({ savedQueries: queries }),

  clearAll: () => set({ currentQuery: null, results: [], isActive: false, savedQueries: [] })
}))

makeHmrSafe('queryStore', useQueryStore)

// Auto re-run the active query whenever its inputs change. Without this
// the Query Results panel shows a snapshot frozen at the moment the
// user last clicked Run — coding new text, removing a coding, renaming
// a code, deleting a doc, or changing a tag wouldn't move a row in or
// out of the visible results until the user re-ran the query manually.
//
// We gate on currentQuery + isActive so re-runs only happen when the
// panel is actually showing something. The check is cheap; query
// execution scales with project size but is in-process and runs on
// store mutations the user is making themselves, so they're already
// paying for the work.
//
// Note: useQuoteStore is not subscribed because query-engine.ts doesn't
// read quotes — quote add/edit/delete affects the Quotes pane only.
function rerunIfActive(): void {
  const s = useQueryStore.getState()
  if (s.currentQuery && s.isActive) s.runQuery()
}
useDocumentStore.subscribe((state, prev) => {
  if (state.sources === prev.sources &&
      state.sourceContents === prev.sourceContents &&
      state.sourceFolder === prev.sourceFolder &&
      state.folders === prev.folders) return
  rerunIfActive()
})
useCodeStore.subscribe((state, prev) => {
  if (state.codes === prev.codes) return
  rerunIfActive()
})
useTagStore.subscribe((state, prev) => {
  if (state.tags === prev.tags) return
  rerunIfActive()
})
