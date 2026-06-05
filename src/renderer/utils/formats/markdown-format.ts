/**
 * Markdown format — full CommonMark + GFM rendering via `marked` lexer.
 */
import type { FormatDef, LineAnnotation } from '../format-registry'
import { parseMarkdownDocument } from '../markdown-parse'

const STYLE_MAP: Record<string, React.CSSProperties> = {
  bold: { fontWeight: 700 },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-tertiary)', borderRadius: 2, padding: '0 2px' },
  'link-text': { color: 'var(--accent)', textDecoration: 'underline' },
  strikethrough: { textDecoration: 'line-through' },
  autolink: { color: 'var(--accent)', textDecoration: 'underline' },
  'html-tag': { color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.9em' },
  'task-checkbox': { fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, fontSize: '0.85em', background: 'var(--bg-tertiary)', borderRadius: 3, padding: '1px 3px', border: '1px solid var(--border-color)' },
  'table-pipe': { color: 'var(--border-color)', padding: '0 4px' },
}

export const markdownFormat: FormatDef = {
  sourceType: 'markdown',
  label: 'Markdown Files',
  extensions: ['md', 'markdown'],

  parseDocument: (text) => {
    const raw = parseMarkdownDocument(text)
    return raw.map((line) => ({
      blockClass: line.blockClass,
      inline: line.inline.map((ann) => {
        if (ann.hidden) {
          return { cpStart: ann.cpStart, cpEnd: ann.cpEnd, style: {}, hidden: true }
        }
        return {
          cpStart: ann.cpStart,
          cpEnd: ann.cpEnd,
          style: STYLE_MAP[ann.style] || {}
        }
      })
    }))
  }
}
