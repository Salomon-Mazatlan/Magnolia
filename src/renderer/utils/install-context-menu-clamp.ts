/**
 * installContextMenuClamp — global safety net that keeps every
 * .context-menu node fully on-screen, regardless of which component
 * rendered it. The hook (use-clamped-menu-position) covers panes that
 * have been explicitly wired through it; this observer covers
 * everything else (document-viewer menus, relationship-map menus, the
 * logbook window, etc.) without per-site changes.
 *
 * How it works:
 *   - A MutationObserver watches document.body for .context-menu node
 *     insertions (direct or nested under any added subtree).
 *   - For each newly-inserted menu, it measures the actual rendered
 *     bounding rect (post-transform — so menus that use translateX
 *     to align to the right of an anchor still clamp correctly) and
 *     shifts the inline left/top by the overflow delta.
 *   - Idempotent: if the menu already fits, nothing changes — so it
 *     plays nicely with the explicit hook-based clamps in the panes.
 *   - Install once per renderer; subsequent calls are no-ops.
 *
 * MutationObserver callbacks are queued as microtasks and run before
 * the browser's next paint, so there's no visible flicker between
 * insertion and clamp.
 */

const EDGE_MARGIN = 4

function clampMenu(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  // Compute how far the menu overflows each viewport edge. Positive
  // numbers mean we need to shift toward the opposite side.
  const overflowRight = Math.max(0, rect.right - (window.innerWidth - EDGE_MARGIN))
  const overflowBottom = Math.max(0, rect.bottom - (window.innerHeight - EDGE_MARGIN))
  const overflowLeft = Math.max(0, EDGE_MARGIN - rect.left)
  const overflowTop = Math.max(0, EDGE_MARGIN - rect.top)
  const dx = overflowLeft - overflowRight
  const dy = overflowTop - overflowBottom
  if (dx === 0 && dy === 0) return

  // Shift the inline left/top by the overflow delta. Works for fixed,
  // absolute, and transformed positioning — the inline coords stay in
  // the menu's own positioning context; the visual rect is what we
  // actually measured.
  const currentLeft = parseFloat(el.style.left) || 0
  const currentTop = parseFloat(el.style.top) || 0
  el.style.left = `${currentLeft + dx}px`
  el.style.top = `${currentTop + dy}px`
}

let installed = false

export function installContextMenuClamp(): void {
  if (installed) return
  installed = true
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.classList.contains('context-menu')) clampMenu(node)
        // Catch context menus nested under any added subtree (e.g.
        // when a parent wrapper containing the menu is added).
        const nested = node.querySelectorAll?.('.context-menu')
        nested?.forEach((el) => clampMenu(el as HTMLElement))
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
