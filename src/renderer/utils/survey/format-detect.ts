/**
 * Detect the source survey-tool format from a parsed CSV grid.
 *
 * Two specific formats are recognised; anything else falls through to
 * `generic`, which means "no built-in conventions — let the user decide
 * per column in the import dialog".
 *
 *   surveymonkey — two-row header. Row 2 contains literal tokens like
 *                  "Response" / "Open-Ended Response" for every
 *                  non-metadata column; row 1 carries the question text
 *                  (and is empty on multi-select continuation columns).
 *
 *   microsoft-forms — single-row header. Row 1 starts with a
 *                     characteristic metadata block ("ID", "Start time",
 *                     "Completion time", optionally Email / Name /
 *                     "Last modified time"); the remaining columns are
 *                     question text.
 *
 *   generic — header layout is unknown. Caller will treat row 1 as
 *             question text, row 2+ as data, and rely on the import
 *             dialog for any column-by-column corrections.
 */

export type SurveyFormat = 'surveymonkey' | 'microsoft-forms' | 'generic'

/** Microsoft Forms metadata column names, lower-cased. The presence of
 *  at least three of these in row 1 is a strong signal we're looking at
 *  an MS Forms export. */
const MS_FORMS_METADATA_HEADERS = new Set([
  'id',
  'start time',
  'completion time',
  'email',
  'name',
  'last modified time',
  'submitter id',
  'submission time'
])

function clean(s: string | undefined): string {
  return (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

export interface DetectionResult {
  format: SurveyFormat
  /** True when the heuristic matched with high confidence (e.g. enough
   *  signature cells). False for `generic` and for borderline matches —
   *  the import dialog should ask the user to confirm. */
  confident: boolean
}

export function detectSurveyFormat(grid: string[][]): DetectionResult {
  if (grid.length === 0) return { format: 'generic', confident: false }
  const row1 = grid[0] ?? []
  const row2 = grid[1] ?? []

  // SurveyMonkey signature: "Response" / "Open-Ended Response" tokens
  // sprinkled through row 2. A handful are enough — most surveys have
  // dozens.
  let smResponseCells = 0
  for (const cell of row2) {
    const c = clean(cell)
    if (c === 'response' || c === 'open-ended response') smResponseCells++
  }
  if (smResponseCells >= 2) return { format: 'surveymonkey', confident: true }

  // Microsoft Forms signature: a run of known metadata headers up
  // front. Counting any-position hits would mis-trigger on surveys
  // that happen to have a column named "Email", so we require the
  // FIRST column to be one of the metadata headers AND at least three
  // of the leading columns to match.
  const firstHeader = clean(row1[0])
  if (firstHeader && MS_FORMS_METADATA_HEADERS.has(firstHeader)) {
    let leadingMetadataHits = 0
    for (let i = 0; i < Math.min(row1.length, 8); i++) {
      if (MS_FORMS_METADATA_HEADERS.has(clean(row1[i]))) leadingMetadataHits++
      else break
    }
    if (leadingMetadataHits >= 3) return { format: 'microsoft-forms', confident: true }
  }

  // Neither signature matched. Caller surfaces the format dropdown so
  // the user can pick.
  return { format: 'generic', confident: false }
}
