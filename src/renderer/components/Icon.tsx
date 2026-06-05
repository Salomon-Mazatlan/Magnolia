/**
 * Single source of truth for icons in Magnolia.
 *
 * The active icon library is selected by the import below. To swap to
 * a different library: install it, create a sibling adapter file in
 * ./icons/ that exports the same fa* names plus an `IconComponent`
 * type, and change the import here.
 *
 * Consumer files use the fa* names (carried over from the original
 * Font Awesome integration) and the <Icon> wrapper, so a library swap
 * doesn't ripple beyond this file.
 */
import * as iconSet from './icons/lucide'
import type { IconComponent } from './icons/lucide'

export type { IconComponent }
export * from './icons/lucide'

/** Semantic aliases — re-resolve to whichever fa* the active set maps to. */
/**
 * Single source of truth for *every* memo glyph in the app — the
 * whole-document FAB, the per-memo row icons in the Memos pane,
 * the in-line memo markers in document viewers, the saved-query /
 * saved-analysis row indicators, the codebook column. Change this
 * one line and the icon swaps everywhere.
 */
export const MEMO_ICON = iconSet.faBookmark
/**
 * Historical aliases kept so call sites can still read as
 * "ranged memo" vs "point memo" where that distinction matters
 * semantically. Both resolve to MEMO_ICON — the visual is unified.
 */
export const MEMO_RANGED_ICON = MEMO_ICON
export const MEMO_POINT_ICON = MEMO_ICON
export const QUOTE_ICON = iconSet.faQuoteLeft
/**
 * Single source of truth for the survey glyph — the clipboard-pen
 * icon shown beside surveys in the Document Browser and in any tab
 * bars that surface surveys. Change this one line and the icon swaps
 * everywhere.
 */
export const SURVEY_ICON = iconSet.faClipboardPen
/**
 * Single source of truth for survey *respondents* and *questions* —
 * used by the Document Browser respondent / question rows AND the
 * Relationship Map's survey-respondent / survey-question nodes so
 * the icon stays consistent across surfaces. Change one line here
 * and every consumer follows.
 */
export const SURVEY_RESPONDENT_ICON = iconSet.faUser
export const SURVEY_QUESTION_ICON = iconSet.faQuestion

interface IconProps {
  icon: IconComponent
  /** Explicit pixel size override. When omitted the icon renders at
   *  1em — i.e. scales with the parent's font-size, preserving the
   *  FA-era convention where callers wrap the icon in an element
   *  styled with `fontSize: N`. Pass an explicit number for buttons
   *  where you want a fixed icon size regardless of font inheritance. */
  size?: number | string
  style?: React.CSSProperties
  className?: string
  title?: string
  onClick?: (e: React.MouseEvent) => void
  onMouseEnter?: (e: React.MouseEvent) => void
  onMouseLeave?: (e: React.MouseEvent) => void
}

export function Icon({
  icon: IconComp,
  size = '1em',
  style,
  className,
  title,
  onClick,
  onMouseEnter,
  onMouseLeave
}: IconProps) {
  return (
    <IconComp
      size={size}
      style={{ width: size, height: size, ...style }}
      className={className}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {title ? <title>{title}</title> : null}
    </IconComp>
  )
}
