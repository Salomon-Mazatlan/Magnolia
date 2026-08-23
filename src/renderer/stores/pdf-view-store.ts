import { create } from 'zustand'

/**
 * Last-known scroll position (px) for each open PDF, keyed by source guid.
 *
 * PdfDocumentViewer only stays mounted while the user is switching between
 * document tabs — visiting a tool tab (Preferences, an Analysis tool, the
 * Query Builder) unmounts it entirely (see DocumentViewer.tsx's
 * `!activeIsTool` block), which would otherwise reset every PDF back to
 * page 1 on return. Living in a store outside the component means the
 * position survives that unmount/remount cycle.
 */
interface PdfViewState {
  scrollPositions: Record<string, number>
  setScrollPosition: (guid: string, scrollTop: number) => void
}

export const usePdfViewStore = create<PdfViewState>((set) => ({
  scrollPositions: {},
  setScrollPosition: (guid, scrollTop) =>
    set((s) => ({ scrollPositions: { ...s.scrollPositions, [guid]: scrollTop } }))
}))
