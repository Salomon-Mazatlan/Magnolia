/**
 * Video metadata extraction.
 *
 * Uses the `music-metadata` library to read container metadata from MP4/
 * MOV/AVI files. `music-metadata` handles MP4 and Matroska containers well
 * and reports duration reliably. For AVI (and as a generic fallback) we
 * return 0 for duration — the renderer's HTML5 <video> element will fill
 * it in on loadedmetadata, which is wired up in VideoDocumentViewer.
 *
 * Width/height aren't reliably reported by music-metadata, so we leave
 * them undefined here and let the <video> element set them after load.
 */

export interface VideoMetadata {
  duration: number   // seconds; 0 if unknown (renderer fills in from element)
  mimeType: string
  width?: number
  height?: number
}

const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo'
}

export async function extractVideoMetadata(filePath: string, ext: string): Promise<VideoMetadata> {
  const mime = MIME_TYPES[ext.toLowerCase()] || 'video/mp4'
  try {
    const mm = await import('music-metadata')
    const metadata = await mm.parseFile(filePath)
    return {
      duration: metadata.format.duration ?? 0,
      mimeType: mime
    }
  } catch {
    // Unsupported container (e.g. some AVI variants) — return 0 duration,
    // the renderer will populate it after the <video> element loads.
    return { duration: 0, mimeType: mime }
  }
}
