import { create } from 'zustand'
import type { TextSource, PlainTextSelection, PdfRegionSelection, TimeRange, Coding, SourceType, DocumentFolder } from '../models/types'
import { generateGuid } from '../utils/guid'
import { useProjectStore } from './project-store'
import { useMemoStore } from './memo-store'
import { useQuoteStore } from './quote-store'
import { deriveLineAnchorsFromTimeRange, deriveVideoTimeRange } from '../components/DocumentViewer/video-time-utils'
import { isToolTab } from '../utils/tab-ids'
import { makeHmrSafe } from './hmr-preserve'

// Re-export so callers that already imported from this store don't break.
export type { DocumentFolder }

/** Key for a selected survey sub-entity in selectedSurveyEntities.
 *  GUIDs contain no ':', so the parts split cleanly. */
export function surveyEntityKey(kind: 'resp' | 'quest', sourceGuid: string, id: string): string {
  return `${kind}:${sourceGuid}:${id}`
}
export function parseSurveyEntityKey(key: string): { kind: 'resp' | 'quest'; sourceGuid: string; id: string } | null {
  const i = key.indexOf(':')
  const j = key.indexOf(':', i + 1)
  if (i < 0 || j < 0) return null
  const kind = key.slice(0, i)
  if (kind !== 'resp' && kind !== 'quest') return null
  return { kind, sourceGuid: key.slice(i + 1, j), id: key.slice(j + 1) }
}

interface DocumentState {
  sources: TextSource[]
  selectedDocumentGuids: Set<string> // selected in the browser (can be multiple)
  /** Selected survey sub-entities (respondents/questions), so a tag can
   *  be applied to many at once. Each key is `${kind}:${sourceGuid}:${id}`
   *  with kind 'resp' | 'quest' (see surveyEntityKey). */
  selectedSurveyEntities: Set<string>
  viewedDocumentGuid: string | null   // active tab in the Document Viewer
  openTabs: string[]                  // ordered list of open document GUIDs (tabs)
  sourceContents: Record<string, string> // guid -> text content
  folders: DocumentFolder[]
  sourceFolder: Record<string, string> // sourceGuid -> folderGuid

  setSources: (sources: TextSource[], contents: Record<string, string>) => void
  addSource: (name: string, content: string, sourceType?: SourceType, formatData?: any) => string // returns guid
  /** Re-attach binary content to an existing source whose bytes were
   *  missing from the .qdpx. Replaces its formatData (the new
   *  magnolia-bin:// handle / pdf data) and text content while preserving
   *  the source's guid, codes, and selections. Marks the project dirty so
   *  the next save embeds the recovered bytes. */
  reattachSourceBinary: (guid: string, formatData: any, content: string) => void
  removeSource: (guid: string) => void
  /** @deprecated use selectDocuments / viewDocument instead */
  selectDocument: (guid: string | null) => void
  selectDocuments: (guids: Set<string>) => void
  selectSurveyEntities: (keys: Set<string>) => void
  viewDocument: (guid: string | null) => void
  closeTab: (guid: string) => void
  reorderTabs: (guids: string[]) => void
  /** Insert any tool tab id (map: / analysis: / query-builder:) into
   *  openTabs and make it active. Tab-kind agnostic. */
  openToolTab: (tabId: string) => void
  /** Remove a tool tab id from openTabs without touching the underlying
   *  per-kind store (callers handle that — relationship-map-store for
   *  maps, analysis-tabs-store for analysis / query-builder). */
  closeToolTab: (tabId: string) => void
  /** Drop every non-document tab on project switch so a tab from project
   *  A doesn't survive into project B. */
  closeAllToolTabs: () => void
  /** Restore openTabs / activeTabId from a persisted snapshot at project
   *  load. validToolTabIds filters out tool tabs that the analysis-tabs-store
   *  failed to rehydrate (so we never strand orphan tab ids). */
  restoreTabs: (
    openTabs: string[],
    activeTabId: string | null,
    validToolTabIds: Set<string>
  ) => void
  getDocumentContent: (guid: string) => string | undefined
  addSelection: (
    sourceGuid: string,
    startPosition: number,
    endPosition: number,
    name: string,
    pdfRegion?: PdfRegionSelection,
    /** When set, the selection is scoped to a single survey cell.
     *  startPosition / endPosition become cell-relative offsets. */
    surveyCell?: { respondentId: string; questionId: string }
  ) => string // returns selection guid
  addCodingToSelection: (
    sourceGuid: string,
    selectionGuid: string,
    codeGuid: string
  ) => void
  removeCoding: (
    sourceGuid: string,
    selectionGuid: string,
    codingGuid: string
  ) => void
  removeSelection: (sourceGuid: string, selectionGuid: string) => void
  /** Create a time-range selection on a video source. Returns selection guid. */
  addTimeRangeSelection: (
    sourceGuid: string,
    startTime: number,
    endTime: number,
    startLine?: number,
    endLine?: number
  ) => string
  /** Update a time-range selection's time bounds (called when user drags
   *  the track bracket handles). By default, clears `manuallyAnchored` so
   *  the transcript's bracket re-derives its line position from the new
   *  time; pass `preserveAnchor: true` from the transcript-bracket drag
   *  (which is updating both the line anchors and the time together). */
  updateSelectionTimeRange: (
    sourceGuid: string,
    selectionGuid: string,
    range: TimeRange,
    options?: { preserveAnchor?: boolean }
  ) => void
  /** Update a time-range selection's line anchors (transcript bracket). The
   *  time range is unchanged; this only rebinds the visual attachment. */
  updateSelectionLineAnchors: (
    sourceGuid: string,
    selectionGuid: string,
    startLine: number,
    endLine: number
  ) => void
  /** Merge a fresh lineTimes map into a video source's formatData AND
   *  re-derive every time-range selection's transcript line anchors
   *  against the new map. This is what keeps codes that were added before
   *  the transcript existed in sync with the text once the user starts
   *  transcribing. */
  updateLineTimes: (
    sourceGuid: string,
    lineTimes: Record<string, number>
  ) => void
  /** Bulk-load folders + per-source folder mapping at project open.
   *  Doesn't markDirty (load paths are already-clean state). */
  setFolders: (folders: DocumentFolder[], sourceFolder: Record<string, string>) => void
  addFolder: (name: string, parentGuid?: string | null) => string
  removeFolder: (guid: string) => void
  renameSource: (guid: string, name: string) => void
  /** Change a single survey question's type (and its columns' types
   *  so they stay in sync). Display switches immediately because
   *  the SurveyViewer dispatches per-question by type. */
  updateSurveyQuestionType: (
    sourceGuid: string,
    questionId: string,
    newType: 'open-ended' | 'single-choice' | 'numeric' | 'multi-select'
  ) => void
  renameFolder: (guid: string, name: string) => void
  moveSourceToFolder: (sourceGuid: string, folderGuid: string | null) => void
  /** Reorder source to before or after a sibling source */
  moveSourceNear: (sourceGuid: string, siblingGuid: string, position: 'before' | 'after') => void
  moveFolderToFolder: (folderGuid: string, newParentGuid: string | null) => void
  updateSourceContent: (guid: string, content: string) => void
  updateSourceFormatData: (guid: string, formatData: any) => void
  /** Open a source in the viewer and pulse a coded range. Consumed by
   *  saved-pane clicks / query-result jumps to spotlight a selection. */
  viewDocumentAt: (
    guid: string,
    startCp: number,
    endCp: number,
    pdfRegion?: PdfRegionSelection,
    timeRange?: TimeRange
  ) => void
  /** Latest scroll/highlight target (consumed by individual viewer
   *  components and cleared after they handle it). */
  scrollTarget: { startCp: number; endCp: number; pdfRegion?: PdfRegionSelection; timeRange?: TimeRange } | null
  clearScrollTarget: () => void
  clearAll: () => void
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  sources: [],
  selectedDocumentGuids: new Set<string>(),
  selectedSurveyEntities: new Set<string>(),
  viewedDocumentGuid: null,
  openTabs: [],
  sourceContents: {},
  folders: [],
  sourceFolder: {},

  setSources: (sources, contents) => {
    // Guarantee the selection invariant `codings: Coding[]` (and that
    // `selections` itself is an array) the moment sources enter the store.
    // Some imported .qdpx selections — notably from survey projects — can
    // arrive with `codings` undefined, which crashes every consumer that
    // iterates `sel.codings` (e.g. CodeBrowser's occurrence count, which
    // tears down the whole window on project load). Normalising here, at
    // the single ingest point, fixes all consumers at once. Clean sources
    // pass through untouched (no needless object churn on large projects).
    const normalized = sources.map((s) => {
      const selections = s.selections ?? []
      let touched = !s.selections
      const fixedSelections = selections.map((sel) => {
        if (sel.codings) return sel
        touched = true
        return { ...sel, codings: [] }
      })
      return touched ? { ...s, selections: fixedSelections } : s
    })
    const validGuids = new Set(normalized.map((s) => s.guid))
    set((state) => ({
      sources: normalized,
      sourceContents: contents,
      // Preserve non-document tabs (map / analysis / query-builder) even
      // when the document list changes — they don't depend on a source guid.
      openTabs: state.openTabs.filter((g) => validGuids.has(g) || isToolTab(g)),
      viewedDocumentGuid:
        state.viewedDocumentGuid &&
        (validGuids.has(state.viewedDocumentGuid) || isToolTab(state.viewedDocumentGuid))
          ? state.viewedDocumentGuid
          : null
    }))
  },

  addSource: (name, content, sourceType, formatData) => {
    const guid = generateGuid()
    const now = new Date().toISOString()
    const userGuid = useProjectStore.getState().creatingUserGUID
    const source: TextSource = {
      guid,
      name,
      sourceType: sourceType || undefined,
      formatData: formatData || undefined,
      creatingUser: userGuid,
      creationDateTime: now,
      modifyingUser: userGuid,
      modifiedDateTime: now,
      selections: []
    }
    set((state) => ({
      sources: [...state.sources, source],
      sourceContents: { ...state.sourceContents, [guid]: content }
    }))
    useProjectStore.getState().markDirty()
    return guid
  },

  reattachSourceBinary: (guid, formatData, content) => {
    const now = new Date().toISOString()
    const userGuid = useProjectStore.getState().creatingUserGUID
    set((state) => {
      // Re-attaching audio/video media carries no text of its own, so never
      // let an empty re-import wipe an existing transcript — keep the current
      // content when the re-imported file brings none. (PDFs etc. bring their
      // extracted text and legitimately replace it.)
      const nextContent = content && content.length > 0 ? content : (state.sourceContents[guid] ?? '')
      return {
        sources: state.sources.map((s) =>
          s.guid === guid
            ? { ...s, formatData: formatData || undefined, modifyingUser: userGuid, modifiedDateTime: now }
            : s
        ),
        sourceContents: { ...state.sourceContents, [guid]: nextContent }
      }
    })
    useProjectStore.getState().markDirty()
  },

  removeSource: (guid) => {
    set((state) => {
      const { [guid]: _, ...rest } = state.sourceContents
      const nextSelected = new Set(state.selectedDocumentGuids)
      nextSelected.delete(guid)
      const nextTabs = state.openTabs.filter((g) => g !== guid)
      let nextViewed = state.viewedDocumentGuid
      if (nextViewed === guid) {
        const oldIdx = state.openTabs.indexOf(guid)
        nextViewed = nextTabs[Math.min(oldIdx, nextTabs.length - 1)] || null
      }
      return {
        sources: state.sources.filter((s) => s.guid !== guid),
        sourceContents: rest,
        selectedDocumentGuids: nextSelected,
        viewedDocumentGuid: nextViewed,
        openTabs: nextTabs
      }
    })
    // Cascade-delete memos linked to this document
    const ms = useMemoStore.getState()
    const linkedMemos = ms.memos.filter(
      (m) => (m.type === 'document' && m.sourceGuids?.includes(guid)) ||
             (m.type === 'content' && m.sourceGuid === guid)
    )
    for (const m of linkedMemos) ms.removeMemo(m.guid)
    // Cascade-delete quotes linked to this document
    const qs = useQuoteStore.getState()
    const linkedQuotes = qs.quotes.filter((q) => q.sourceGuid === guid)
    for (const q of linkedQuotes) qs.removeQuote(q.guid)

    useProjectStore.getState().markDirty()
  },

  selectDocument: (guid) => set({
    selectedDocumentGuids: guid ? new Set([guid]) : new Set<string>(),
    viewedDocumentGuid: guid
  }),
  selectDocuments: (guids) => set({ selectedDocumentGuids: guids }),
  selectSurveyEntities: (keys) => set({ selectedSurveyEntities: keys }),
  viewDocument: (guid) => {
    set((state) => {
      if (!guid) return { viewedDocumentGuid: null }
      return {
        viewedDocumentGuid: guid,
        openTabs: state.openTabs.includes(guid) ? state.openTabs : [...state.openTabs, guid]
      }
    })
    // Tab state (openTabs + viewedDocumentGuid) is persisted in
    // magnolia-tabs.json, so tab navigation needs to mark the project
    // dirty for the autosave to pick up the new active-tab pointer.
    // Otherwise quitting without any other edit leaves the saved
    // activeTabId stuck on whatever the last "real" edit captured.
    useProjectStore.getState().markDirty()
  },
  closeTab: (guid) => {
    set((state) => {
      const nextTabs = state.openTabs.filter((g) => g !== guid)
      let nextViewed = state.viewedDocumentGuid
      if (nextViewed === guid) {
        const oldIdx = state.openTabs.indexOf(guid)
        nextViewed = nextTabs[Math.min(oldIdx, nextTabs.length - 1)] || null
      }
      return { openTabs: nextTabs, viewedDocumentGuid: nextViewed }
    })
    useProjectStore.getState().markDirty()
  },
  reorderTabs: (guids) => {
    set({ openTabs: guids })
    useProjectStore.getState().markDirty()
  },
  openToolTab: (tabId) => {
    set((state) => ({
      viewedDocumentGuid: tabId,
      openTabs: state.openTabs.includes(tabId)
        ? state.openTabs
        : [...state.openTabs, tabId]
    }))
    useProjectStore.getState().markDirty()
  },
  closeToolTab: (tabId) => {
    set((state) => {
      const nextTabs = state.openTabs.filter((g) => g !== tabId)
      let nextViewed = state.viewedDocumentGuid
      if (nextViewed === tabId) {
        const oldIdx = state.openTabs.indexOf(tabId)
        nextViewed = nextTabs[Math.min(oldIdx, nextTabs.length - 1)] || null
      }
      return { openTabs: nextTabs, viewedDocumentGuid: nextViewed }
    })
    useProjectStore.getState().markDirty()
  },
  closeAllToolTabs: () => {
    set((state) => ({
      openTabs: state.openTabs.filter((g) => !isToolTab(g)),
      viewedDocumentGuid:
        state.viewedDocumentGuid && isToolTab(state.viewedDocumentGuid)
          ? null
          : state.viewedDocumentGuid
    }))
    useProjectStore.getState().markDirty()
  },
  restoreTabs: (openTabs, activeTabId, validToolTabIds) => {
    const sourcesAtLoad = get().sources
    const validSources = new Set(sourcesAtLoad.map((s) => s.guid))
    const filtered = openTabs.filter((id) =>
      isToolTab(id) ? validToolTabIds.has(id) : validSources.has(id)
    )
    const nextActive =
      activeTabId && filtered.includes(activeTabId)
        ? activeTabId
        : filtered[0] ?? null
    set({ openTabs: filtered, viewedDocumentGuid: nextActive })
  },
  scrollTarget: null as { startCp: number; endCp: number; pdfRegion?: PdfRegionSelection; timeRange?: TimeRange } | null,
  viewDocumentAt: (guid: string, startCp: number, endCp: number, pdfRegion?: PdfRegionSelection, timeRange?: TimeRange) => set((state) => ({
    viewedDocumentGuid: guid,
    openTabs: state.openTabs.includes(guid) ? state.openTabs : [...state.openTabs, guid],
    scrollTarget: { startCp, endCp, pdfRegion, timeRange }
  })),
  clearScrollTarget: () => set({ scrollTarget: null }),

  getDocumentContent: (guid) => get().sourceContents[guid],

  addSelection: (sourceGuid, startPosition, endPosition, name, pdfRegion?, surveyCell?) => {
    const selGuid = generateGuid()
    const now = new Date().toISOString()
    const userGuid = useProjectStore.getState().creatingUserGUID
    const selection: PlainTextSelection = {
      guid: selGuid,
      name,
      startPosition,
      endPosition,
      pdfRegion,
      surveyCell,
      creatingUser: userGuid,
      creationDateTime: now,
      codings: []
    }
    set((state) => {
      // Video transcript codings are character-precise but also project onto
      // the CodeTrack timeline: derive a time range from the transcript lines
      // the selected text spans (line-granular timing — adjusting the text
      // within a line leaves the time range; crossing onto another line
      // moves it). Audio/text/pdf codings carry no time range.
      const source = state.sources.find((s) => s.guid === sourceGuid)
      if (source?.sourceType === 'video' && !pdfRegion && !surveyCell) {
        const tr = deriveVideoTimeRange(
          state.sourceContents[sourceGuid] ?? '',
          startPosition,
          endPosition,
          source.formatData?.lineTimes
        )
        if (tr) selection.timeRange = tr
      }
      return {
        sources: state.sources.map((s) =>
          s.guid === sourceGuid ? { ...s, selections: [...s.selections, selection] } : s
        )
      }
    })
    useProjectStore.getState().markDirty()
    return selGuid
  },

  addCodingToSelection: (sourceGuid, selectionGuid, codeGuid) => {
    const codingGuid = generateGuid()
    const now = new Date().toISOString()
    const userGuid = useProjectStore.getState().creatingUserGUID
    const coding: Coding = {
      guid: codingGuid,
      codeGuid,
      creatingUser: userGuid,
      creationDateTime: now
    }
    set((state) => ({
      sources: state.sources.map((s) =>
        s.guid === sourceGuid
          ? {
              ...s,
              selections: s.selections.map((sel) =>
                sel.guid === selectionGuid
                  ? { ...sel, codings: [...sel.codings, coding] }
                  : sel
              )
            }
          : s
      )
    }))
    useProjectStore.getState().markDirty()
  },

  removeCoding: (sourceGuid, selectionGuid, codingGuid) => {
    set((state) => ({
      sources: state.sources.map((s) =>
        s.guid === sourceGuid
          ? {
              ...s,
              selections: s.selections.map((sel) =>
                sel.guid === selectionGuid
                  ? {
                      ...sel,
                      codings: sel.codings.filter((c) => c.guid !== codingGuid)
                    }
                  : sel
              )
            }
          : s
      )
    }))
    useProjectStore.getState().markDirty()
  },

  addTimeRangeSelection: (sourceGuid, startTime, endTime, startLine, endLine) => {
    const selGuid = generateGuid()
    const now = new Date().toISOString()
    const userGuid = useProjectStore.getState().creatingUserGUID
    // If line anchors weren't supplied (e.g. the code was dropped on the
    // CodeTrack or the video frame rather than on a transcript selection),
    // derive them from the source's lineTimes so the bracket lands on the
    // transcript lines that correspond to the time range.
    let finalStart = startLine
    let finalEnd = endLine
    if (finalStart === undefined || finalEnd === undefined) {
      const source = get().sources.find((s) => s.guid === sourceGuid)
      const lineTimes = source?.formatData?.lineTimes as Record<string, number> | undefined
      const derived = deriveLineAnchorsFromTimeRange(startTime, endTime, lineTimes)
      if (finalStart === undefined) finalStart = derived.startLine
      if (finalEnd === undefined) finalEnd = derived.endLine
    }
    const selection: PlainTextSelection = {
      guid: selGuid,
      startPosition: finalStart ?? 0,
      endPosition: finalEnd ?? finalStart ?? 0,
      timeRange: { startTime, endTime },
      creatingUser: userGuid,
      creationDateTime: now,
      codings: []
    }
    set((state) => ({
      sources: state.sources.map((s) =>
        s.guid === sourceGuid
          ? { ...s, selections: [...s.selections, selection] }
          : s
      )
    }))
    useProjectStore.getState().markDirty()
    return selGuid
  },

  updateSelectionTimeRange: (sourceGuid, selectionGuid, range, options) => {
    const preserveAnchor = options?.preserveAnchor === true
    set((state) => ({
      sources: state.sources.map((s) =>
        s.guid === sourceGuid
          ? {
              ...s,
              selections: s.selections.map((sel) =>
                sel.guid === selectionGuid
                  ? preserveAnchor
                    ? { ...sel, timeRange: range }
                    : { ...sel, timeRange: range, manuallyAnchored: false }
                  : sel
              )
            }
          : s
      )
    }))
    useProjectStore.getState().markDirty()
  },

  updateSelectionLineAnchors: (sourceGuid, selectionGuid, startLine, endLine) => {
    set((state) => ({
      sources: state.sources.map((s) =>
        s.guid === sourceGuid
          ? {
              ...s,
              selections: s.selections.map((sel) =>
                sel.guid === selectionGuid
                  ? {
                      ...sel,
                      startPosition: startLine,
                      endPosition: endLine,
                      // Mark this bracket as manually anchored so a
                      // subsequent transcription edit (which re-derives
                      // anchors from lineTimes) won't clobber the user's
                      // deliberate placement.
                      manuallyAnchored: true
                    }
                  : sel
              )
            }
          : s
      )
    }))
    useProjectStore.getState().markDirty()
  },

  updateLineTimes: (sourceGuid, lineTimes) => {
    set((state) => ({
      sources: state.sources.map((s) => {
        if (s.guid !== sourceGuid) return s
        const newFormatData = { ...(s.formatData || {}), lineTimes }
        // For every time-range selection, re-derive its line anchors
        // against the fresh lineTimes. This covers two cases:
        //   1. The code was added before any transcript existed — it was
        //      placed at line 0 by default and now jumps to the correct
        //      line(s) as soon as transcription catches up in time.
        //   2. Transcription added / removed lines, shifting later lines
        //      up or down — the bracket follows its canonical time range.
        // Brackets that the user has manually repositioned in the
        // transcript (manuallyAnchored: true) are LEFT ALONE — their
        // placement is a deliberate user choice we must preserve.
        const newSelections = s.selections.map((sel) => {
          if (!sel.timeRange || sel.manuallyAnchored) return sel
          const derived = deriveLineAnchorsFromTimeRange(
            sel.timeRange.startTime,
            sel.timeRange.endTime,
            lineTimes
          )
          if (sel.startPosition === derived.startLine && sel.endPosition === derived.endLine) {
            return sel
          }
          return { ...sel, startPosition: derived.startLine, endPosition: derived.endLine }
        })
        return { ...s, formatData: newFormatData, selections: newSelections }
      })
    }))
    useProjectStore.getState().markDirty()
  },

  removeSelection: (sourceGuid, selectionGuid) => {
    set((state) => ({
      sources: state.sources.map((s) =>
        s.guid === sourceGuid
          ? {
              ...s,
              selections: s.selections.filter(
                (sel) => sel.guid !== selectionGuid
              )
            }
          : s
      )
    }))
    useProjectStore.getState().markDirty()
  },

  setFolders: (folders, sourceFolder) => {
    set({ folders, sourceFolder })
  },

  addFolder: (name, parentGuid = null) => {
    const guid = generateGuid()
    set((state) => ({
      folders: [...state.folders, { guid, name, parentGuid }]
    }))
    useProjectStore.getState().markDirty()
    return guid
  },

  removeFolder: (guid) => {
    set((state) => {
      // Collect all descendant folder guids
      const toRemove = new Set<string>()
      const collect = (id: string) => {
        toRemove.add(id)
        for (const f of state.folders) {
          if (f.parentGuid === id) collect(f.guid)
        }
      }
      collect(guid)
      // Move documents in removed folders to root
      const newSourceFolder = { ...state.sourceFolder }
      for (const [sg, fg] of Object.entries(newSourceFolder)) {
        if (toRemove.has(fg)) delete newSourceFolder[sg]
      }
      return {
        folders: state.folders.filter((f) => !toRemove.has(f.guid)),
        sourceFolder: newSourceFolder
      }
    })
    useProjectStore.getState().markDirty()
  },

  renameSource: (guid, name) => {
    set((state) => ({
      sources: state.sources.map((s) => (s.guid === guid ? { ...s, name } : s))
    }))
    useProjectStore.getState().markDirty()
  },

  updateSurveyQuestionType: (sourceGuid, questionId, newType) => {
    set((state) => ({
      sources: state.sources.map((s) => {
        if (s.guid !== sourceGuid) return s
        const fd = (s.formatData as any) // SurveyFormatData when sourceType === 'survey'
        const survey = fd?.survey
        if (!survey) return s
        const newQuestions = survey.questions.map((q: any) =>
          q.id === questionId ? { ...q, type: newType } : q
        )
        // Keep the column-level type in sync so anything that
        // consumes per-column types (the import preview re-open,
        // serialization, etc.) sees a consistent picture.
        const touchedColumnIds = new Set<string>()
        const target = newQuestions.find((q: any) => q.id === questionId)
        if (target) {
          for (const c of target.columns) touchedColumnIds.add(c.columnId)
        }
        const newColumns = survey.columns.map((col: any) =>
          touchedColumnIds.has(col.id) ? { ...col, type: newType } : col
        )
        return {
          ...s,
          formatData: {
            ...fd,
            survey: {
              ...survey,
              questions: newQuestions,
              columns: newColumns
            }
          }
        }
      })
    }))
    useProjectStore.getState().markDirty()
  },

  renameFolder: (guid, name) => {
    set((state) => ({
      folders: state.folders.map((f) => (f.guid === guid ? { ...f, name } : f))
    }))
    useProjectStore.getState().markDirty()
  },

  moveSourceToFolder: (sourceGuid, folderGuid) => {
    set((state) => {
      const newSourceFolder = { ...state.sourceFolder }
      if (folderGuid === null) {
        delete newSourceFolder[sourceGuid]
      } else {
        newSourceFolder[sourceGuid] = folderGuid
      }
      return { sourceFolder: newSourceFolder }
    })
    useProjectStore.getState().markDirty()
  },

  moveSourceNear: (sourceGuid, siblingGuid, position) => {
    if (sourceGuid === siblingGuid) return
    set((state) => {
      const source = state.sources.find((s) => s.guid === sourceGuid)
      if (!source) return state
      // Move the source into the same folder as the sibling
      const siblingFolder = state.sourceFolder[siblingGuid] || null
      const newSourceFolder = { ...state.sourceFolder }
      if (siblingFolder) {
        newSourceFolder[sourceGuid] = siblingFolder
      } else {
        delete newSourceFolder[sourceGuid]
      }
      // Reorder within the sources array
      const without = state.sources.filter((s) => s.guid !== sourceGuid)
      const sibIdx = without.findIndex((s) => s.guid === siblingGuid)
      if (sibIdx < 0) return state
      const insertIdx = position === 'before' ? sibIdx : sibIdx + 1
      const newSources = [...without]
      newSources.splice(insertIdx, 0, source)
      return { sources: newSources, sourceFolder: newSourceFolder }
    })
    useProjectStore.getState().markDirty()
  },

  moveFolderToFolder: (folderGuid, newParentGuid) => {
    // Prevent moving a folder into its own descendant
    const isDescendant = (parentId: string, childId: string): boolean => {
      const folders = get().folders
      for (const f of folders) {
        if (f.parentGuid === parentId) {
          if (f.guid === childId) return true
          if (isDescendant(f.guid, childId)) return true
        }
      }
      return false
    }
    if (newParentGuid && (folderGuid === newParentGuid || isDescendant(folderGuid, newParentGuid))) {
      return
    }
    set((state) => ({
      folders: state.folders.map((f) =>
        f.guid === folderGuid ? { ...f, parentGuid: newParentGuid } : f
      )
    }))
    useProjectStore.getState().markDirty()
  },

  updateSourceContent: (guid, content) => {
    set((state) => ({
      sourceContents: { ...state.sourceContents, [guid]: content }
    }))
    useProjectStore.getState().markDirty()
  },

  updateSourceFormatData: (guid, formatData) => {
    set((state) => ({
      sources: state.sources.map((s) =>
        s.guid === guid ? { ...s, formatData: { ...s.formatData, ...formatData } } : s
      )
    }))
    useProjectStore.getState().markDirty()
  },

  clearAll: () =>
    set({ sources: [], selectedDocumentGuids: new Set<string>(), selectedSurveyEntities: new Set<string>(), viewedDocumentGuid: null, openTabs: [], sourceContents: {}, folders: [], sourceFolder: {} })
}))

makeHmrSafe('documentStore', useDocumentStore)
