import type JSZip from 'jszip'

/**
 * REFI-QDA doesn't mandate a case for the binary/text-sources folder name.
 * Magnolia has always written (and read) lowercase "sources", but NVivo
 * exports it as "Sources" — a case-sensitive `zip.file('sources/...')`
 * lookup against an NVivo archive silently returns null for every source,
 * which is why transcript text, PDFs, images, audio, and video all came up
 * blank after importing an NVivo QDPX (see GitHub issue #7).
 *
 * Detect whichever casing is actually present once per archive so every
 * lookup can build its path off the real folder name. Falls back to the
 * lowercase default when no such top-level folder exists at all (e.g. a
 * project with no external source files), which matches the prior
 * behaviour exactly — existing lowercase archives are unaffected.
 */
export function detectSourcesDir(zip: JSZip): string {
  for (const path of Object.keys(zip.files)) {
    const slash = path.indexOf('/')
    if (slash > 0 && path.slice(0, slash).toLowerCase() === 'sources') {
      return path.slice(0, slash)
    }
  }
  return 'sources'
}
