import type { FormatDef } from '../format-registry'

export const plainTextFormat: FormatDef = {
  sourceType: 'text',
  label: 'Text Files',
  extensions: ['txt'],
  parseDocument: () => null,
}
