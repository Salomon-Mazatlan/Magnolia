/**
 * TIFF / HEIC → PNG conversion at import time. Chromium can't render
 * either format in an <img>, so we decode to RGBA in the main process
 * and re-encode as PNG. Downstream code only ever sees a normal PNG
 * buffer — no renderer-side changes needed.
 *
 * Libraries are all pure-JS: `utif` for TIFF, `heic-decode` (WASM
 * libheif under the hood) for HEIC, `pngjs` for encoding RGBA → PNG.
 */
import UTIF from 'utif'
import heicDecode from 'heic-decode'
import { PNG } from 'pngjs'

export interface ImageConvertResult {
  /** PNG bytes ready to be written to disk. */
  buffer: Buffer
  /** The normalised extension the renderer treats the file as. */
  ext: 'png'
  /** Matching MIME type. */
  mimeType: 'image/png'
}

/** Encode an RGBA byte array to a PNG buffer. */
function encodePng(rgba: Uint8Array | Buffer, width: number, height: number): Buffer {
  const png = new PNG({ width, height })
  // pngjs expects a Buffer; copy RGBA in directly. Length is w * h * 4.
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  return PNG.sync.write(png)
}

/**
 * Decode the first page/layer of a TIFF buffer and encode it as PNG.
 * Multi-page TIFFs are reduced to their first image — typical use case
 * in QDA is a scanned page where page 1 is what the user wants coded.
 */
export function convertTiffToPng(buffer: Buffer): ImageConvertResult {
  const ifds = UTIF.decode(buffer)
  if (ifds.length === 0) throw new Error('TIFF file contains no images')
  const first = ifds[0]
  UTIF.decodeImage(buffer, first)
  const rgba = UTIF.toRGBA8(first) as Uint8Array
  const png = encodePng(rgba, first.width, first.height)
  return { buffer: png, ext: 'png', mimeType: 'image/png' }
}

/**
 * Decode a HEIC/HEIF buffer via libheif-js (WASM) and encode as PNG.
 * Like the TIFF path, only the primary image is kept — HEIC containers
 * can hold image sequences / burst-mode captures but the primary is
 * what the user sees in Photos.
 */
export async function convertHeicToPng(buffer: Buffer): Promise<ImageConvertResult> {
  const { width, height, data } = await heicDecode({ buffer })
  const png = encodePng(data, width, height)
  return { buffer: png, ext: 'png', mimeType: 'image/png' }
}
