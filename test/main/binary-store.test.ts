import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import {
  setActiveProjectPath,
  noteActiveProjectPath,
  clearOverlay,
  putOverlay,
  markPersisted,
  resolveHandle,
  archiveHandle
} from '../../src/main/binary-store'

const GUID = 'ED6E609B-72F3-48E9-8DFB-EC04843AA865'
const AUDIO_BYTES = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x52, 0x49, 0x46, 0x46]) // arbitrary

const dir = mkdtempSync(join(tmpdir(), 'magnolia-binstore-'))

/** Write a minimal .qdpx (zip) that embeds the audio binary under
 *  sources/<guid>.m4a, exactly as writeQdpx does. */
async function makeQdpx(name: string, guid = GUID, ext = 'm4a'): Promise<string> {
  const zip = new JSZip()
  zip.folder('sources')!.file(`${guid}.${ext}`, AUDIO_BYTES)
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const path = join(dir, name)
  writeFileSync(path, buf)
  return path
}

beforeEach(() => {
  clearOverlay()
  setActiveProjectPath(null)
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('binary-store — archive is the source of truth', () => {
  it('resolves an archive handle straight from the open .qdpx by guid', async () => {
    const path = await makeQdpx('a.qdpx')
    setActiveProjectPath(path)
    const bytes = await resolveHandle(archiveHandle(GUID, 'm4a'))
    expect(bytes).not.toBeNull()
    expect(Buffer.from(bytes!).equals(AUDIO_BYTES)).toBe(true)
  })

  it('resolves an archive handle even when the recorded extension is wrong (guid-prefix fallback)', async () => {
    const path = await makeQdpx('b.qdpx')
    setActiveProjectPath(path)
    // Promotion picked the wrong ext, but the binary is found by its guid.
    const bytes = await resolveHandle(archiveHandle(GUID, 'wav'))
    expect(bytes).not.toBeNull()
    expect(Buffer.from(bytes!).equals(AUDIO_BYTES)).toBe(true)
  })
})

describe('binary-store — overlay → persisted lifecycle', () => {
  it('serves a fresh import from memory, then from the archive after it is persisted', async () => {
    const path = await makeQdpx('c.qdpx')
    setActiveProjectPath(path)
    const handle = putOverlay(AUDIO_BYTES, 'm4a')
    // Before persist: served from the in-memory overlay buffer.
    expect(Buffer.from((await resolveHandle(handle))!).equals(AUDIO_BYTES)).toBe(true)
    // Persist: buffer freed, token→guid recorded.
    markPersisted(handle, GUID)
    // After persist: still resolves — now from the archive via token→guid.
    expect(Buffer.from((await resolveHandle(handle))!).equals(AUDIO_BYTES)).toBe(true)
  })

  it('REGRESSION: a persisted import still resolves after a same-path save (no clearOverlay)', async () => {
    const path = await makeQdpx('d.qdpx')
    setActiveProjectPath(path)
    const handle = putOverlay(AUDIO_BYTES, 'm4a')
    markPersisted(handle, GUID)
    // The save handler re-asserts the same path; this must NOT drop the mapping.
    noteActiveProjectPath(path)
    setActiveProjectPath(path)
    expect(await resolveHandle(handle)).not.toBeNull()
  })

  it('REGRESSION: a null active-path (closing/loading) does not drop a persisted import', async () => {
    const path = await makeQdpx('e.qdpx')
    setActiveProjectPath(path)
    const handle = putOverlay(AUDIO_BYTES, 'm4a')
    markPersisted(handle, GUID)
    setActiveProjectPath(null) // must be a no-op for the overlay
    expect(await resolveHandle(handle)).not.toBeNull()
  })

  it('DOES drop the previous project\'s import when switching to a different project', async () => {
    const path = await makeQdpx('f.qdpx')
    setActiveProjectPath(path)
    const handle = putOverlay(AUDIO_BYTES, 'm4a')
    markPersisted(handle, GUID)
    const other = await makeQdpx('g.qdpx', '11111111-1111-1111-1111-111111111111')
    setActiveProjectPath(other) // genuine switch → overlay invalidated
    expect(await resolveHandle(handle)).toBeNull()
  })
})
