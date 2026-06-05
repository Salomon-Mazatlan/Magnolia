/**
 * useClampedMenuPosition — keeps a context menu fully on-screen.
 *
 * Pass the click-anchored coords ({x, y}) as state. The hook returns a
 * ref to attach to the menu element and the clamped (x, y) to render
 * at. After the menu mounts, it measures itself and re-positions so it
 * never overflows the right or bottom edge of the window. Useful for
 * pane context menus near the window border — without the clamp, the
 * tail of the menu disappears outside the window chrome.
 *
 * Edge handling:
 *  - Right / bottom: shift up by (menu width / height + margin) so the
 *    full menu fits.
 *  - Left / top: clamped to a small margin so the menu can't escape
 *    in the unlikely case it's wider than the viewport.
 *
 * Implementation note: the layout effect runs synchronously before
 * paint, so the unclamped first-render coords are never visible.
 */
import { useLayoutEffect, useRef, useState } from 'react'

const EDGE_MARGIN = 4

export function useClampedMenuPosition(
  anchor: { x: number; y: number } | null
): { ref: React.RefObject<HTMLDivElement>; x: number; y: number } {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor) { setSize(null); return }
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize({ w: rect.width, h: rect.height })
  }, [anchor])

  let x = anchor?.x ?? 0
  let y = anchor?.y ?? 0
  if (size) {
    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - size.w - EDGE_MARGIN)
    const maxY = Math.max(EDGE_MARGIN, window.innerHeight - size.h - EDGE_MARGIN)
    x = Math.min(Math.max(EDGE_MARGIN, x), maxX)
    y = Math.min(Math.max(EDGE_MARGIN, y), maxY)
  }

  return { ref, x, y }
}
