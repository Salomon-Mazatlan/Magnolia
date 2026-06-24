import { describe, it, expect } from 'vitest'
import { promotedArchiveHandle, isOverlayHandle, mediaPathField } from '../../src/renderer/utils/binary-handles'

const overlay = (ext: string) => `magnolia-bin://overlay/B6A4B1A1-D80F-4538-B67E-76A66ADF8EBF.${ext}`

describe('promotedArchiveHandle', () => {
  it('promotes an audio overlay handle to an archive handle under the source guid', () => {
    const src = { guid: 'ED6E609B-72F3-48E9-8DFB-EC04843AA865', sourceType: 'audio', formatData: { audioExt: 'm4a', audioFilePath: overlay('m4a') } }
    expect(promotedArchiveHandle(src)).toBe('magnolia-bin://archive/ED6E609B-72F3-48E9-8DFB-EC04843AA865.m4a')
  })

  it('promotes video / image / pdf overlay handles using their own extension', () => {
    expect(promotedArchiveHandle({ guid: 'G1', sourceType: 'video', formatData: { videoExt: 'mp4', videoFilePath: overlay('mp4') } }))
      .toBe('magnolia-bin://archive/G1.mp4')
    expect(promotedArchiveHandle({ guid: 'G2', sourceType: 'image', formatData: { imageExt: 'png', imageFilePath: overlay('png') } }))
      .toBe('magnolia-bin://archive/G2.png')
    expect(promotedArchiveHandle({ guid: 'G3', sourceType: 'pdf', formatData: { pdfFilePath: overlay('pdf') } }))
      .toBe('magnolia-bin://archive/G3.pdf')
  })

  it('falls back to the extension encoded in the overlay handle when formatData has none', () => {
    const src = { guid: 'G4', sourceType: 'audio', formatData: { audioFilePath: overlay('wav') } }
    expect(promotedArchiveHandle(src)).toBe('magnolia-bin://archive/G4.wav')
  })

  it('returns null when the media path is already an archive handle (nothing to promote)', () => {
    const src = { guid: 'G5', sourceType: 'audio', formatData: { audioExt: 'm4a', audioFilePath: 'magnolia-bin://archive/G5.m4a' } }
    expect(promotedArchiveHandle(src)).toBeNull()
  })

  it('returns null for a source with no media handle, and for non-media source types', () => {
    expect(promotedArchiveHandle({ guid: 'G6', sourceType: 'audio', formatData: {} })).toBeNull()
    expect(promotedArchiveHandle({ guid: 'G7', sourceType: 'text', formatData: { audioFilePath: overlay('m4a') } })).toBeNull()
    expect(promotedArchiveHandle({ guid: 'G8', sourceType: 'audio' })).toBeNull()
  })
})

describe('isOverlayHandle / mediaPathField', () => {
  it('recognises overlay handles only', () => {
    expect(isOverlayHandle(overlay('m4a'))).toBe(true)
    expect(isOverlayHandle('magnolia-bin://archive/G.m4a')).toBe(false)
    expect(isOverlayHandle('/tmp/file.m4a')).toBe(false)
    expect(isOverlayHandle(undefined)).toBe(false)
  })

  it('maps each media source type to its handle field', () => {
    expect(mediaPathField('audio')).toBe('audioFilePath')
    expect(mediaPathField('video')).toBe('videoFilePath')
    expect(mediaPathField('image')).toBe('imageFilePath')
    expect(mediaPathField('pdf')).toBe('pdfFilePath')
    expect(mediaPathField('text')).toBeNull()
  })
})
