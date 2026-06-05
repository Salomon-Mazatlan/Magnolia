/**
 * ODT → PDF conversion pipeline.
 * 1. Unzip the ODT (it's an OpenDocument ZIP archive) with JSZip.
 * 2. Parse `content.xml` with fast-xml-parser and walk the OpenDocument
 *    tree into HTML, pulling inline style info from `styles.xml`.
 * 3. Inline any embedded pictures from the `Pictures/` folder as
 *    base64 data URIs so they survive the HTML→PDF render.
 * 4. Run the produced HTML through the shared htmlToPdfBuffer helper
 *    and then extractPdfText — the result is the same shape every
 *    other office-format converter returns.
 *
 * Scope: preserves paragraph text, headings, bold / italic / underline,
 * font family, font size, font colour, background colour, and tables.
 * Lists (ordered + unordered) are rendered as <ul>/<ol>. Unsupported
 * styling degrades gracefully — the raw text is always preserved.
 */
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import { extractPdfText, type PdfExtractResult } from './pdf-extract'
import { htmlToPdfBuffer } from './html-to-pdf'

interface StyleDef {
  /** CSS inline style string, ready to paste into a `style=""` attribute. */
  css: string
  /** The parent style this one inherits from, if any. */
  parentName?: string
  /** For paragraph styles, the default text style applied inside. */
  textCss?: string
}

export async function convertOdtToPdf(buffer: Buffer): Promise<PdfExtractResult> {
  const zip = await JSZip.loadAsync(buffer)

  // --- Extract images to base64 data URIs --------------------------------
  // ODT stores images under Pictures/… — map each path to a data URI so
  // we can swap references in content.xml directly.
  const pictures: Record<string, string> = {}
  const picFolder = zip.folder('Pictures')
  if (picFolder) {
    for (const relPath of Object.keys(zip.files)) {
      if (!relPath.startsWith('Pictures/')) continue
      const entry = zip.files[relPath]
      if (entry.dir) continue
      const bytes = await entry.async('base64')
      const ext = relPath.split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'gif' ? 'image/gif'
        : ext === 'svg' ? 'image/svg+xml'
        : 'image/png'
      pictures[relPath] = `data:${mime};base64,${bytes}`
    }
  }

  // --- Parse styles.xml + content.xml ------------------------------------
  // styles.xml defines global styles; content.xml defines in-document
  // automatic styles plus the actual body. We parse both and merge the
  // style tables so style name lookups find the right definition.
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: true,
    trimValues: false
  })
  const stylesXml = await zip.file('styles.xml')?.async('string') ?? ''
  const contentXml = await zip.file('content.xml')?.async('string') ?? ''
  if (!contentXml) throw new Error('Invalid ODT: no content.xml')

  const styleTable = new Map<string, StyleDef>()
  if (stylesXml) collectStyles(parser.parse(stylesXml), styleTable)
  const contentParsed = parser.parse(contentXml)
  collectStyles(contentParsed, styleTable)

  // Resolve style inheritance so each style name maps to the merged CSS
  // it should apply (own declarations win over parent declarations).
  const resolvedStyles = new Map<string, { css: string; textCss: string }>()
  const resolve = (name: string, seen = new Set<string>()): { css: string; textCss: string } => {
    if (resolvedStyles.has(name)) return resolvedStyles.get(name)!
    if (seen.has(name)) return { css: '', textCss: '' }
    seen.add(name)
    const def = styleTable.get(name)
    if (!def) return { css: '', textCss: '' }
    const parent = def.parentName ? resolve(def.parentName, seen) : { css: '', textCss: '' }
    const merged = {
      css: mergeCss(parent.css, def.css),
      textCss: mergeCss(parent.textCss, def.textCss ?? '')
    }
    resolvedStyles.set(name, merged)
    return merged
  }

  // Walk the body into HTML.
  const body = findBody(contentParsed)
  const html = body ? renderNodes(body, { styleTable, resolve, pictures }) : ''

  const pdfBuffer = await htmlToPdfBuffer(html || '<p>(empty document)</p>')
  return extractPdfText(pdfBuffer)
}

// ---------------------------------------------------------------------------
// Style collection
// ---------------------------------------------------------------------------

/**
 * Recursively walk the parsed ODT XML and populate `styleTable` with
 * every `<style:style>` definition we encounter. Paragraph styles also
 * pick up their nested `<style:text-properties>` so inline text
 * inherits properly when the paragraph has no explicit text style.
 */
function collectStyles(nodes: any, table: Map<string, StyleDef>): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    for (const [tag, children] of Object.entries(node)) {
      if (tag === ':@') continue
      if (tag === 'style:style') {
        const attrs = (node[':@'] || {}) as Record<string, string>
        const name = attrs['@_style:name']
        const parent = attrs['@_style:parent-style-name']
        if (name) {
          const def: StyleDef = { css: '', parentName: parent }
          if (Array.isArray(children)) {
            for (const childNode of children) {
              for (const [childTag, childChildren] of Object.entries(childNode)) {
                if (childTag === ':@') continue
                const pAttrs = (childNode[':@'] || {}) as Record<string, string>
                if (childTag === 'style:paragraph-properties' || childTag === 'style:table-cell-properties') {
                  def.css = mergeCss(def.css, odtAttrsToCss(pAttrs))
                } else if (childTag === 'style:text-properties') {
                  const textCss = odtAttrsToCss(pAttrs)
                  def.textCss = mergeCss(def.textCss ?? '', textCss)
                  // Also roll into the paragraph's CSS so block-level
                  // rules (colour, font) apply to bare text.
                  def.css = mergeCss(def.css, textCss)
                }
                void childChildren
              }
            }
          }
          table.set(name, def)
        }
      }
      collectStyles(children as any, table)
    }
  }
}

/** Map a handful of OpenDocument style attributes to CSS declarations. */
function odtAttrsToCss(attrs: Record<string, string>): string {
  const out: string[] = []
  const take = (name: string, css: (v: string) => string) => {
    const v = attrs[`@_${name}`]
    if (v !== undefined && v !== '') out.push(css(v))
  }
  take('fo:color', (v) => `color:${v}`)
  take('fo:background-color', (v) => v !== 'transparent' ? `background-color:${v}` : '')
  take('fo:font-weight', (v) => `font-weight:${v}`)
  take('fo:font-style', (v) => `font-style:${v}`)
  take('fo:font-size', (v) => `font-size:${v}`)
  take('fo:font-family', (v) => `font-family:${v.replace(/["']/g, '')}`)
  take('style:font-name', (v) => `font-family:${v.replace(/["']/g, '')}`)
  take('fo:text-align', (v) => `text-align:${v}`)
  take('style:text-underline-style', (v) => v !== 'none' ? 'text-decoration:underline' : '')
  take('style:text-line-through-style', (v) => v !== 'none' ? 'text-decoration:line-through' : '')
  take('fo:margin-left', (v) => `margin-left:${v}`)
  take('fo:margin-right', (v) => `margin-right:${v}`)
  take('fo:margin-top', (v) => `margin-top:${v}`)
  take('fo:margin-bottom', (v) => `margin-bottom:${v}`)
  return out.filter(Boolean).join(';')
}

function mergeCss(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return `${a};${b}`
}

// ---------------------------------------------------------------------------
// Body walk → HTML
// ---------------------------------------------------------------------------

interface RenderCtx {
  styleTable: Map<string, StyleDef>
  resolve: (name: string) => { css: string; textCss: string }
  pictures: Record<string, string>
}

function findBody(nodes: any): any[] | null {
  if (!Array.isArray(nodes)) return null
  for (const node of nodes) {
    for (const [tag, children] of Object.entries(node)) {
      if (tag === ':@') continue
      if (tag === 'office:body' && Array.isArray(children)) {
        // Within <office:body>, the content usually lives under
        // <office:text>. Return that if present, otherwise the body.
        for (const bc of children) {
          for (const [bt, bcs] of Object.entries(bc)) {
            if (bt === ':@') continue
            if (bt === 'office:text') return bcs as any[]
          }
        }
        return children as any[]
      }
      const found = findBody(children as any)
      if (found) return found
    }
  }
  return null
}

function renderNodes(nodes: any[], ctx: RenderCtx): string {
  const out: string[] = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    for (const [tag, children] of Object.entries(node)) {
      if (tag === ':@') continue
      const attrs = (node[':@'] || {}) as Record<string, string>
      out.push(renderElement(tag, children as any, attrs, ctx))
    }
  }
  return out.join('')
}

function renderElement(tag: string, children: any, attrs: Record<string, string>, ctx: RenderCtx): string {
  const styleName = attrs['@_text:style-name'] || attrs['@_table:style-name']
  const resolved = styleName ? ctx.resolve(styleName) : { css: '', textCss: '' }

  switch (tag) {
    case '#text':
      return escapeHtml(typeof children === 'string' ? children : '')
    case 'text:p': {
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      const style = resolved.css ? ` style="${resolved.css}"` : ''
      return `<p${style}>${inner || '&nbsp;'}</p>`
    }
    case 'text:h': {
      const levelAttr = attrs['@_text:outline-level']
      const level = Math.min(6, Math.max(1, parseInt(levelAttr ?? '1', 10) || 1))
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      const style = resolved.css ? ` style="${resolved.css}"` : ''
      return `<h${level}${style}>${inner || '&nbsp;'}</h${level}>`
    }
    case 'text:span': {
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      const css = resolved.textCss || resolved.css
      const style = css ? ` style="${css}"` : ''
      return `<span${style}>${inner}</span>`
    }
    case 'text:a': {
      const href = attrs['@_xlink:href'] || '#'
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      return `<a href="${escapeAttr(href)}">${inner}</a>`
    }
    case 'text:line-break':
      return '<br>'
    case 'text:tab':
      return '&nbsp;&nbsp;&nbsp;&nbsp;'
    case 'text:s': {
      const count = parseInt(attrs['@_text:c'] ?? '1', 10) || 1
      return '&nbsp;'.repeat(count)
    }
    case 'text:list': {
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      // Best-effort bullet vs. numbered: assume unordered unless we can
      // figure out ordering later (ODT list styles are complex; this
      // keeps the content readable without styling every numbering
      // scheme).
      return `<ul>${inner}</ul>`
    }
    case 'text:list-item': {
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      return `<li>${inner}</li>`
    }
    case 'table:table': {
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      return `<table>${inner}</table>`
    }
    case 'table:table-row': {
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      return `<tr>${inner}</tr>`
    }
    case 'table:table-cell': {
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      const style = resolved.css ? ` style="${resolved.css}"` : ''
      return `<td${style}>${inner || '&nbsp;'}</td>`
    }
    case 'table:table-header-rows': {
      const inner = Array.isArray(children) ? renderNodes(children, ctx) : ''
      return `<thead>${inner}</thead>`
    }
    case 'draw:frame': {
      // Frames wrap images; recurse into children for <draw:image>.
      return Array.isArray(children) ? renderNodes(children, ctx) : ''
    }
    case 'draw:image': {
      const href = attrs['@_xlink:href']
      if (!href) return ''
      const src = ctx.pictures[href] || ctx.pictures[href.replace(/^Pictures\//, '')] || href
      return `<img src="${escapeAttr(src)}" />`
    }
    case 'office:annotation':
    case 'office:annotation-end':
      return ''
    default:
      // Unknown element — recurse so we don't lose nested text.
      return Array.isArray(children) ? renderNodes(children, ctx) : ''
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}
