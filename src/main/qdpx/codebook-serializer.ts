import { app } from 'electron'
import { XMLBuilder } from 'fast-xml-parser'
import type { Code } from '../../renderer/models/types'

// XML special-char escaping. Order matters: replace & first so the
// subsequent replacements don't re-escape the ampersand we just emitted
// for the entity references.
function xmlEscapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
function xmlEscapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  // fast-xml-parser collapses any attribute whose stringified value is
  // exactly "true" into HTML-style boolean syntax (just the attribute
  // name, no value). REFI-QDA's schema mandates a value for booleans
  // like isCodable, so Atlas.ti rejects the file with "Specification
  // mandates value for attribute isCodable" when this collapsing is
  // active. Force the builder to always emit name="value".
  suppressBooleanAttributes: false,
  // Take entity-encoding control away from fast-xml-parser and do it
  // ourselves. The library's default escaping has gaps (notably in
  // attribute values) that produced REFI-QDA files external tools
  // like Atlas.ti rejected with "attributes construct error" on
  // codes whose name contained &, <, >, or " characters.
  processEntities: false,
  attributeValueProcessor: (_name, value) =>
    typeof value === 'string' ? xmlEscapeAttr(value) : String(value),
  tagValueProcessor: (_name, value) =>
    typeof value === 'string' ? xmlEscapeText(value) : String(value)
})

function serializeCode(code: Code): any {
  const obj: any = {
    '@_guid': code.guid,
    '@_name': code.name,
    // REFI-QDA requires isCodable on every Code element. Default to
    // true when the field is undefined (legacy data or codes imported
    // from a tool that didn't set it) so the export never produces an
    // empty / missing attribute and never throws on .toString() of
    // undefined.
    '@_isCodable': (code.isCodable ?? true).toString()
  }
  if (code.color) obj['@_color'] = code.color
  if (code.description) obj.Description = code.description
  if (code.children.length > 0) {
    obj.Code = code.children.map(serializeCode)
  }
  return obj
}

/**
 * Serialize a code tree to the REFI-QDA Codebook (.qdc) XML format.
 * This is the Phase 1 standard (urn:QDA-XML:codebook:1.0) — a plain XML file
 * containing only the code hierarchy, colors, and descriptions.
 */
export function serializeCodebook(codes: Code[]): string {
  const doc: any = {
    '?xml': { '@_version': '1.0', '@_encoding': 'utf-8' },
    CodeBook: {
      '@_xmlns': 'urn:QDA-XML:codebook:1.0',
      '@_origin': `Magnolia ${app.getVersion()}`
    }
  }

  if (codes.length > 0) {
    doc.CodeBook.Codes = {
      Code: codes.map(serializeCode)
    }
  }

  return uppercaseGuids(builder.build(doc))
}

/** Mirror of xml-serializer.ts's helper: upper-cases the value of every
 *  attribute that carries a GUID so the output matches the QDA-XML 1.0
 *  schema's uppercase-hex GUIDType pattern. Atlas.ti and MAXQDA both
 *  validate against this pattern and reject lowercase guids. */
function uppercaseGuids(xml: string): string {
  const guidPattern = /\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/g
  return xml.replace(
    /\b(guid|targetGUID|creatingUser(?:GUID)?|modifyingUser(?:GUID)?)="([^"]+)"/g,
    (_m, attr, val) => {
      const upped = val.replace(guidPattern, (g: string) => g.toUpperCase())
      return `${attr}="${upped}"`
    }
  )
}
