import { app } from 'electron'
import { access, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

/**
 * Remembers, per project (.qdpx path), the folder a file was last
 * imported from — so the next Import dialog for that project opens
 * where the last one left off instead of always defaulting to Home.
 * Lives in its own small file in userData, mirroring the pattern used
 * for updater state.
 *
 * Every check here is async (never fs's *Sync variants): this sits
 * directly in the click → dialog path, and a sync stat/read blocks the
 * whole main process — including window rendering and every other IPC
 * handler — for as long as the filesystem takes to answer. That's
 * unbounded if the remembered folder turns out to be on an unmounted
 * network share or removable drive.
 */
function importDirsPath(): string {
  return join(app.getPath('userData'), 'magnolia-import-dirs.json')
}

async function readAll(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(importDirsPath(), 'utf-8'))
  } catch {
    /* ignore — treat as no history */
  }
  return {}
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function getLastImportDir(projectPath: string | null): Promise<string | undefined> {
  if (!projectPath) return undefined
  const dir = (await readAll())[projectPath]
  // The remembered folder may have been moved, renamed, or be on an
  // unmounted external/network drive since the last import — don't hand
  // Electron a dead defaultPath, since dialog fallback behavior in that
  // case isn't consistent across platforms. Fall back to the OS default
  // (undefined) instead.
  if (dir && (await pathExists(dir))) return dir
  return undefined
}

export async function setLastImportDir(projectPath: string | null, dir: string): Promise<void> {
  if (!projectPath) return
  try {
    const all = await readAll()
    all[projectPath] = dir
    await writeFile(importDirsPath(), JSON.stringify(all, null, 2))
  } catch {
    /* ignore */
  }
}
