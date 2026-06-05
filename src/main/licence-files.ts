import { app, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

/**
 * Open one of the bundled licence text files in the OS's default text
 * viewer. Packaged: electron-builder's `extraResources` copies them to
 * <App>/Contents/Resources/ (process.resourcesPath). NOT inside the
 * asar — shell.openPath can't read into asar archives. Dev: the files
 * live at the repo root.
 *
 * Single source of truth for the file lookup so the Help-menu
 * "Acknowledgements" item and the renderer's Licence dialog both go
 * through the same candidate list.
 */
export function openBundledLicenceFile(filename: 'LICENSE' | 'THIRD-PARTY-LICENSES.txt'): void {
  const candidates = [
    join(process.resourcesPath, filename),
    join(process.cwd(), filename),
    join(app.getAppPath(), '..', filename),
    join(app.getAppPath(), filename)
  ]
  const found = candidates.find((p) => existsSync(p))
  if (found) shell.openPath(found)
}
