import { useMemo } from 'react'
import { marked } from 'marked'

// Configure marked for safe, inline-friendly rendering
marked.setOptions({
  breaks: true,    // Convert \n to <br>
  gfm: true        // GitHub-flavoured markdown (tables, strikethrough, etc.)
})

interface Props {
  text: string
  className?: string
  style?: React.CSSProperties
}

/**
 * Renders a markdown string as sanitised HTML.
 * Used for code memos and similar user-authored rich text.
 */
export function Markdown({ text, className, style }: Props) {
  const html = useMemo(() => {
    if (!text) return ''
    return marked.parse(text, { async: false }) as string
  }, [text])

  return (
    <div
      className={`markdown-content ${className ?? ''}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Convert markdown to HTML string (for PDF export etc.)
 */
export function markdownToHtml(text: string): string {
  if (!text) return ''
  return marked.parse(text, { async: false }) as string
}
