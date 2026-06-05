/**
 * Video format definition for the format registry.
 * The VideoDocumentViewer handles its own rendering (player + track +
 * transcript), so parseDocument returns null.
 */
import type { FormatDef } from '../format-registry'

export const videoFormat: FormatDef = {
  sourceType: 'video',
  label: 'Video Files',
  extensions: ['mp4', 'mov', 'avi'],
  parseDocument: () => null
}
