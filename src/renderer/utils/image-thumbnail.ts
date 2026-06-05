/**
 * image-thumbnail — render a cropped PNG thumbnail of an image region.
 *
 * Used by the unified PdfRegionThumbnail when the underlying source is an
 * image rather than a PDF. Mirrors pdf-thumbnail.ts's caching strategy:
 *  - HTMLImageElement objects cached by filePath.
 *  - Rendered data-URL thumbnails cached by (filePath, x, y, w, h) key.
 *  - In-flight requests deduped — repeated requests share one Promise.
 */

interface ThumbnailOptions {
  filePath: string
  x: number
  y: number
  width: number
  height: number
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()
const thumbCache = new Map<string, string>()
const inFlight = new Map<string, Promise<string>>()

async function loadImage(filePath: string): Promise<HTMLImageElement> {
  let promise = imageCache.get(filePath)
  if (!promise) {
    promise = (async () => {
      const buffer = await window.api.readImageFile(filePath)
      const blob = new Blob([buffer])
      const url = URL.createObjectURL(blob)
      try {
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Image failed to load'))
          img.src = url
        })
        return img
      } finally {
        // Keep the Image alive but free the object URL — Chrome retains a
        // decoded copy on the Image element.
        URL.revokeObjectURL(url)
      }
    })()
    imageCache.set(filePath, promise)
  }
  return promise
}

function cacheKey(opts: ThumbnailOptions): string {
  return `${opts.filePath}::${opts.x}::${opts.y}::${opts.width}::${opts.height}`
}

/** Render a cropped PNG thumbnail and return a data: URL for an `<img src>`. */
export async function renderImageRegionThumbnail(opts: ThumbnailOptions): Promise<string> {
  const key = cacheKey(opts)
  const cached = thumbCache.get(key)
  if (cached) return cached
  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = (async () => {
    const img = await loadImage(opts.filePath)

    // Clamp the crop rect to the image's natural bounds so we don't ask
    // canvas to copy from outside the source (results in a black band).
    const srcX = Math.max(0, Math.round(opts.x))
    const srcY = Math.max(0, Math.round(opts.y))
    const srcW = Math.min(img.naturalWidth - srcX, Math.round(opts.width))
    const srcH = Math.min(img.naturalHeight - srcY, Math.round(opts.height))
    if (srcW <= 0 || srcH <= 0) {
      throw new Error('Region is outside the image bounds')
    }

    const canvas = document.createElement('canvas')
    canvas.width = srcW
    canvas.height = srcH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to create canvas 2D context')
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH)

    const dataUrl = canvas.toDataURL('image/png')
    thumbCache.set(key, dataUrl)
    return dataUrl
  })()

  inFlight.set(key, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(key)
  }
}

/** Clear all caches — call when a project is closed or an image is unloaded. */
export function clearImageThumbnailCaches(): void {
  imageCache.clear()
  thumbCache.clear()
  inFlight.clear()
}
