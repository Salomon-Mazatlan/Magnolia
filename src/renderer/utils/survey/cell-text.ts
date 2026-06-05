/**
 * Canonical "what does a survey cell look like to the user" helpers.
 *
 * Selections on survey sources store their startPosition/endPosition
 * as codepoint offsets into the CLEANED cell text rendered by the
 * CodedTextView — not into the source's raw CSV. Anything that needs
 * to recover the text that was coded (the survey viewer's CodedTextView,
 * the query engine's result-snippet builder, text search inside cells)
 * must apply the same cleaning, or its offsets will land on the wrong
 * characters.
 *
 * Keep the two functions here as the single source of truth so a
 * cleaning-rule change in one place can't silently desync the other.
 */

/** Strip HTML tags, decode the common XML entities, collapse runs of
 *  whitespace. Mirrors the survey viewer's `clean` helper exactly. */
export function cleanCellText(raw: string): string {
  return (raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Build the cell text shown to the user for an open-ended /
 *  single-choice / multi-select answer cell. Multi-select answers
 *  (string[]) are joined with newlines so each chosen option occupies
 *  its own line in the viewer; single answers are cleaned directly. */
export function buildCellText(answer: string | string[] | undefined): string {
  if (Array.isArray(answer)) return answer.map(cleanCellText).join('\n')
  return cleanCellText(answer ?? '')
}
