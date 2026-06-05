/**
 * Display labels for survey sub-entities, keyed by survey source guid:
 * respondent id → displayName, question id → text. Used by the Document
 * Selector to list which respondents/questions a tag filter targets
 * (the selector otherwise only has entity ids, not names).
 */
import type { TextSource, SurveyFormatData } from '../../models/types'

export type SurveyEntityLabels = Record<
  string,
  { respondents: Record<string, string>; questions: Record<string, string> }
>

export function buildSurveyEntityLabels(sources: TextSource[]): SurveyEntityLabels {
  const out: SurveyEntityLabels = {}
  for (const s of sources) {
    if ((s as { sourceType?: string }).sourceType !== 'survey') continue
    const survey = (s.formatData as SurveyFormatData | undefined)?.survey
    if (!survey) continue
    const respondents: Record<string, string> = {}
    for (const r of survey.respondents) respondents[r.id] = r.displayName
    const questions: Record<string, string> = {}
    for (const q of survey.questions) questions[q.id] = q.text
    out[s.guid] = { respondents, questions }
  }
  return out
}
