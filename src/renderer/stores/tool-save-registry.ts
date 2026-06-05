/**
 * tool-save-registry — a tabId-keyed registry of save handlers for the
 * unsaved-changes dialog the TabBar shows on close.
 *
 * Each open tool tab (analysis tool, query builder, relationship map)
 * registers a `save()` callback at mount. When the user clicks Close on
 * a dirty tab, the TabBar's confirm dialog can call `invokeSave(tabId)`
 * to dispatch the same save the tool's Save / Update Analysis button
 * would.
 *
 * The handler returns a boolean: true if save completed synchronously
 * (so the close can proceed); false if it deferred (typically because
 * the tool needed to open a "name this" sub-dialog for a never-saved
 * tool, in which case the close is abandoned and the user follows the
 * inner dialog through manually).
 */
import { create } from 'zustand'

export type ToolSaveHandler = () => boolean

interface State {
  handlers: Record<string, ToolSaveHandler>
  register: (tabId: string, handler: ToolSaveHandler) => void
  unregister: (tabId: string) => void
  invokeSave: (tabId: string) => boolean
}

export const useToolSaveRegistry = create<State>((set, get) => ({
  handlers: {},
  register: (tabId, handler) => {
    set((s) => ({ handlers: { ...s.handlers, [tabId]: handler } }))
  },
  unregister: (tabId) => {
    set((s) => {
      const next = { ...s.handlers }
      delete next[tabId]
      return { handlers: next }
    })
  },
  invokeSave: (tabId) => {
    const handler = get().handlers[tabId]
    if (!handler) return false
    return handler()
  }
}))
