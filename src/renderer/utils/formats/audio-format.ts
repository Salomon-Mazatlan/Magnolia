/**
 * Audio format definition for the format registry.
 * The AudioDocumentViewer handles its own rendering (waveform + transcript),
 * so parseDocument returns null.
 */
import type { FormatDef } from '../format-registry'

export const audioFormat: FormatDef = {
  sourceType: 'audio',
  label: 'Audio Files',
  extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'],
  parseDocument: () => null
}
