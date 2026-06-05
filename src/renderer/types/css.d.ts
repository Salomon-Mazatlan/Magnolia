/**
 * Augment csstype's Properties (which React.CSSProperties aliases) so
 * the Electron-specific `-webkit-app-region` value is allowed in inline
 * styles. Used to mark areas of a custom-titlebar window as draggable
 * (`'drag'`) or explicitly non-draggable (`'no-drag'`) for child
 * controls. csstype doesn't ship this property because it's not in any
 * CSS spec — it's a Chromium/Electron extension.
 */
import 'csstype'

declare module 'csstype' {
  interface Properties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}

/**
 * Electron extends DOM `File` (the kind you get from a drag-and-drop
 * `DataTransfer`) with an absolute filesystem `path`. Augment the
 * global `File` interface so the renderer can read it without casting.
 */
declare global {
  interface File {
    readonly path: string
  }

  /** App version, injected at build time from package.json via the
   *  renderer `define` in electron.vite.config.ts. */
  const __APP_VERSION__: string
}

export {}
