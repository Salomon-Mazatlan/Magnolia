/**
 * use-register-tool-save — register a tool's save handler with the
 * global tool-save-registry while the tool is mounted, so the TabBar's
 * unsaved-changes confirm dialog can call it.
 *
 * The handler is wrapped in a ref so the latest closure is always
 * invoked, but the *registered* function reference is stable across
 * renders. Without that, every render would unregister + re-register.
 *
 * Returns nothing. No-ops when tabId is undefined (popout windows have
 * no tab to register against).
 */
import { useEffect, useRef } from 'react'
import { useToolSaveRegistry, type ToolSaveHandler } from '../stores/tool-save-registry'

export function useRegisterToolSave(tabId: string | undefined, save: ToolSaveHandler): void {
  const handlerRef = useRef(save)
  handlerRef.current = save
  useEffect(() => {
    if (!tabId) return
    const reg = useToolSaveRegistry.getState()
    reg.register(tabId, () => handlerRef.current())
    return () => reg.unregister(tabId)
  }, [tabId])
}
