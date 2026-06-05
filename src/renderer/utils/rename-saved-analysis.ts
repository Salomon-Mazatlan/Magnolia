import { useProjectStore } from '../stores/project-store'

/**
 * Rename a single saved-analysis entry in project.savedAnalyses without
 * touching its config. Used by the inline title-rename in each analysis
 * tool's header. No-op when the guid isn't found.
 */
export function renameSavedAnalysis(guid: string, newName: string): void {
  const ps = useProjectStore.getState()
  const existing = ps.savedAnalyses ?? []
  const idx = existing.findIndex((a) => a.guid === guid)
  if (idx < 0) return
  const next = [...existing]
  next[idx] = {
    ...next[idx],
    name: newName,
    modifiedDateTime: new Date().toISOString()
  }
  ps.setSavedAnalyses(next)
}
