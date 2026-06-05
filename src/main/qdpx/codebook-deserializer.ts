import { XMLParser } from 'fast-xml-parser'
import type { Code } from '../../renderer/models/types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['Code'].includes(name)
})

function normalizeGuid(guid: string | undefined): string {
  if (!guid) return ''
  return guid.replace(/[{}]/g, '')
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

function parseCode(xmlCode: any): Code {
  const children = ensureArray(xmlCode.Code).map(parseCode)
  return {
    guid: normalizeGuid(xmlCode['@_guid']),
    name: xmlCode['@_name'] ?? '',
    isCodable: xmlCode['@_isCodable'] === 'false' ? false : true,
    color: xmlCode['@_color'],
    description: xmlCode.Description,
    children
  }
}

/**
 * Parse a REFI-QDA Codebook (.qdc) XML file and return the code tree.
 */
export function deserializeCodebook(xml: string): Code[] {
  const parsed = parser.parse(xml)
  const codebook = parsed.CodeBook
  if (!codebook) return []
  return ensureArray(codebook.Codes?.Code).map(parseCode)
}
