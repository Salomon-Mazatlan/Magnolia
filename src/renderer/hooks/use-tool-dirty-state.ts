/**
 * use-tool-dirty-state — shared dirty-tracking for the analysis tools
 * and the Query Builder, which all share the same shape: ad-hoc
 * useState-backed config + an optional savedConfig prop. There is no
 * autosave; persistence is explicit (Save Analysis / Update Analysis /
 * Save Query / Update Query).
 *
 * Each tool keeps a `baseline` snapshot of the last persisted config:
 *   - new tool, never saved → baseline starts as the empty defaults the
 *     tool seeded its useState calls with, so a freshly-opened tool
 *     reads as clean. The first user edit flips it to dirty.
 *   - existing saved tool → baseline starts as savedConfig, so opening
 *     a saved tool also reads as clean.
 *   - on Save → caller invokes setBaseline(currentConfig) so dirty
 *     resets to false.
 *   - on Discard → caller resets each piece of useState back to the
 *     fields in `baseline`.
 *
 * `dirty` is derived from JSON.stringify(currentConfig) !== JSON.stringify(baseline).
 * That works because the configs are plain JSON-serialisable data
 * (numbers, strings, arrays, objects) and avoids a deep-equal
 * dependency. Field order in the object literal must be stable across
 * renders for the comparison to hold — pass the same object shape each
 * time.
 *
 * `inTab.onDirtyChange` lets the host (InlineAnalysisTab → analysis-tabs-store)
 * know when the dirty flag flips so the tab strip can render an
 * unsaved-changes marker.
 */
import { useEffect, useMemo, useState } from 'react'

export function useToolDirtyState<T>(
  currentConfig: T,
  initialBaseline: T,
  inTab?: { onDirtyChange?: (dirty: boolean) => void }
): { dirty: boolean; baseline: T; setBaseline: (next: T) => void } {
  const [baseline, setBaseline] = useState<T>(initialBaseline)
  const dirty = useMemo(
    () => JSON.stringify(currentConfig) !== JSON.stringify(baseline),
    [currentConfig, baseline]
  )
  const onDirtyChange = inTab?.onDirtyChange
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  return { dirty, baseline, setBaseline }
}
