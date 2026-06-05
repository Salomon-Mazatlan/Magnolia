/**
 * Image format definition for the format registry.
 * The ImageDocumentViewer renders the image and box-coding overlays itself,
 * so parseDocument returns null (no inline annotations on a non-text source).
 */
import type { FormatDef } from '../format-registry'

export const imageFormat: FormatDef = {
  sourceType: 'image',
  label: 'Images',
  // tif / tiff / heic / heif aren't natively renderable in Chromium,
  // but the main-process importer decodes them to PNG at import time
  // so the renderer ever only sees a PNG on disk. They're listed here
  // so the file picker / drag-drop / sourceType detection all treat
  // them as image sources.
  extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'heic', 'heif'],
  parseDocument: () => null
}
