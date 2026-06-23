import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

import { deserializeCodebook } from '../../src/main/qdpx/codebook-deserializer'
import { serializeCodebook } from '../../src/main/qdpx/codebook-serializer'
import type { Code } from '../../src/renderer/models/types'

describe('REFI-QDA codebook (.qdc)', () => {
  it('normalises GUIDs to uppercase and strips braces on import', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CodeBook xmlns="urn:QDA-XML:codebook:1.0">
  <Codes>
    <Code guid="{2a08bddf-4c35-4250-bf77-7de37b50c930}" name="parent" isCodable="true">
      <Code guid="2d969af8-c875-4fae-bcd8-f0162bc27396" name="child" isCodable="true"/>
    </Code>
  </Codes>
</CodeBook>`
    const codes = deserializeCodebook(xml)
    expect(codes).toHaveLength(1)
    expect(codes[0].guid).toBe('2A08BDDF-4C35-4250-BF77-7DE37B50C930') // uppercased, braces stripped
    expect(codes[0].children[0].guid).toBe('2D969AF8-C875-4FAE-BCD8-F0162BC27396')
  })

  it('round-trips a code tree through serialize → deserialize with uppercase GUIDs', () => {
    const original: Code[] = [
      {
        guid: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
        name: 'theme',
        isCodable: true,
        color: '#FF8800',
        description: 'a theme',
        children: [
          { guid: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB', name: 'sub', isCodable: false, children: [] }
        ]
      }
    ]
    const restored = deserializeCodebook(serializeCodebook(original))
    expect(restored).toHaveLength(1)
    expect(restored[0].guid).toBe(original[0].guid)
    expect(restored[0].children[0].guid).toBe(original[0].children[0].guid)
    expect(restored[0].children[0].isCodable).toBe(false)
    expect(restored[0].color).toBe('#FF8800')
  })
})
