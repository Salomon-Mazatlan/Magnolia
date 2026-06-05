import { create } from 'zustand'
import { useProjectStore } from './project-store'
import { generateGuid } from '../utils/guid'
import type { Quote, PdfRegionSelection } from '../models/types'
import { makeHmrSafe } from './hmr-preserve'

interface QuoteState {
  quotes: Quote[]
  setQuotes: (quotes: Quote[]) => void
  addQuote: (
    sourceGuid: string,
    sourceName: string,
    startPosition: number,
    endPosition: number,
    text: string,
    pdfRegion?: PdfRegionSelection,
    /** Survey-cell context: when set, startPosition/endPosition are
     *  cell-relative offsets inside the named (respondent × question)
     *  cell. */
    surveyCell?: { respondentId: string; questionId: string }
  ) => string
  removeQuote: (guid: string) => void
  getQuotesForSource: (sourceGuid: string) => Quote[]
  clearAll: () => void
}

export const useQuoteStore = create<QuoteState>((set, get) => ({
  quotes: [],

  setQuotes: (quotes) => set({ quotes }),

  addQuote: (sourceGuid, sourceName, startPosition, endPosition, text, pdfRegion, surveyCell) => {
    const guid = generateGuid()
    const quote: Quote = {
      guid,
      sourceGuid,
      sourceName,
      startPosition,
      endPosition,
      text,
      pdfRegion,
      surveyCell,
      createdDateTime: new Date().toISOString()
    }
    set((s) => ({ quotes: [...s.quotes, quote] }))
    useProjectStore.getState().markDirty()
    return guid
  },

  removeQuote: (guid) => {
    set((s) => ({ quotes: s.quotes.filter((q) => q.guid !== guid) }))
    useProjectStore.getState().markDirty()
  },

  getQuotesForSource: (sourceGuid) => {
    return get().quotes.filter((q) => q.sourceGuid === sourceGuid)
  },

  clearAll: () => set({ quotes: [] })
}))

makeHmrSafe('quoteStore', useQuoteStore)
