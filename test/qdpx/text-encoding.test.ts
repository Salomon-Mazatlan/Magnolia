import { describe, it, expect } from 'vitest'
import { decodeMaybeWindows1252 } from '../../src/main/qdpx/text-encoding'

describe('decodeMaybeWindows1252', () => {
  it('decodes valid UTF-8 (Magnolia\'s own files) unchanged', () => {
    const utf8 = new TextEncoder().encode('Héllo — “world” 😀')
    expect(decodeMaybeWindows1252(utf8)).toBe('Héllo — “world” 😀')
  })

  it('decodes a Windows-1252 curly apostrophe instead of producing U+FFFD', () => {
    // Atlas writes "He's" with a 0x92 (right single quote) — invalid UTF-8.
    const cp1252 = new Uint8Array([0x48, 0x65, 0x92, 0x73])
    const decoded = decodeMaybeWindows1252(cp1252)
    expect(decoded).toBe('He’s')
    expect(decoded).not.toContain('�')
  })

  it('decodes Windows-1252 curly quotes, em dash and ellipsis', () => {
    // “quote” … — written by Atlas as 0x93/0x94/0x85/0x97.
    const cp1252 = new Uint8Array([0x93, 0x71, 0x94, 0x20, 0x85, 0x20, 0x97])
    expect(decodeMaybeWindows1252(cp1252)).toBe('“q” … —')
  })

  it('leaves plain ASCII untouched', () => {
    const ascii = new TextEncoder().encode('plain text 123')
    expect(decodeMaybeWindows1252(ascii)).toBe('plain text 123')
  })
})
