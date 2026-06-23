/**
 * Decode a text buffer from a .qdpx, tolerating non-UTF-8 transcripts.
 *
 * Magnolia writes its own text as UTF-8, but other tools (Atlas.ti) write
 * transcript .txt files in Windows-1252 — so a curly apostrophe (byte 0x92),
 * curly quotes (0x93/0x94), em dash (0x97), ellipsis (0x85), etc. decode to
 * the U+FFFD replacement character ("�") under a strict UTF-8 read. Decode as
 * UTF-8 when the bytes are valid UTF-8 (the common case), and fall back to
 * Windows-1252 otherwise. Valid UTF-8 with high bytes is essentially never a
 * false positive, so this is safe to apply to every text read.
 */
export function decodeMaybeWindows1252(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}
