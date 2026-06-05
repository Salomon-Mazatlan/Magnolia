import { create } from 'zustand'

/**
 * Per-survey "which sub-view is showing" state.
 *
 * The survey source itself opens as a single tab. Within that tab the
 * user can flip between the summary view, an individual respondent's
 * answers, or an individual question's responses. Tracking this state
 * outside the tab system means the existing `openTabs: string[]`
 * model — one entry per source guid — doesn't need to learn about
 * surveys.
 *
 * Stage 4 reads + writes here from the DocumentBrowser tree clicks
 * and from the SurveyViewer mode selector. Stage 5's coding pipeline
 * will also read the active mode + childId so cell-level codings can
 * be re-mapped onto whatever view's text is currently rendered.
 */
export type SurveyViewMode = 'summary' | 'respondent' | 'question'

export interface SurveyView {
  mode: SurveyViewMode
  /** For 'respondent' mode: the respondent id; for 'question' mode:
   *  the question id; for 'summary': undefined. */
  childId?: string
}

/** Transient scroll target — when the viewer renders next and the
 *  target's surveyGuid matches the active source, scroll the cell
 *  matching `(respondentId, questionId)` into view. The viewer
 *  clears the target after consuming it so the same target doesn't
 *  re-fire on later renders. */
export interface SurveyScrollTarget {
  surveyGuid: string
  respondentId?: string
  questionId?: string
}

interface SurveyViewState {
  viewBySurveyGuid: Record<string, SurveyView>
  scrollTarget: SurveyScrollTarget | null
  setView: (surveyGuid: string, mode: SurveyViewMode, childId?: string) => void
  /** Tell the viewer to scroll to the named cell on its next render. */
  setScrollTarget: (target: SurveyScrollTarget | null) => void
  /** Lookup helper that returns the default summary view when no
   *  explicit selection has been made yet. */
  getView: (surveyGuid: string) => SurveyView
}

export const useSurveyViewStore = create<SurveyViewState>((set, get) => ({
  viewBySurveyGuid: {},
  scrollTarget: null,
  setView: (surveyGuid, mode, childId) =>
    set((s) => ({
      viewBySurveyGuid: {
        ...s.viewBySurveyGuid,
        [surveyGuid]: { mode, childId }
      }
    })),
  setScrollTarget: (target) => set({ scrollTarget: target }),
  getView: (surveyGuid) =>
    get().viewBySurveyGuid[surveyGuid] ?? { mode: 'summary' }
}))
