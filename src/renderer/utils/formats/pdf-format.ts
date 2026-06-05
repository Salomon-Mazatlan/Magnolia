/**
 * PDF format — PDF viewer handles its own rendering via pdfjs-dist.
 * No line-based annotation parsing needed.
 */
import type { FormatDef } from '../format-registry'

export const pdfFormat: FormatDef = {
  sourceType: 'pdf',
  label: 'PDF Documents',
  extensions: ['pdf'],
  parseDocument: () => null,
}
