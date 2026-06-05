import { createContext } from 'react'

/** Maps sourceGuid → absolute PDF file path. Lives in context so any
 *  element deep inside the relationship map can look up the file path
 *  for a thumbnail it needs to render, without prop-drilling through
 *  MapCanvas → MapElement → thumbnail. */
export const PdfFilePathsContext = createContext<Record<string, string>>({})
