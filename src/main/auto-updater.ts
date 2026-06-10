/**
 * Auto-update wiring (electron-updater + GitHub Releases).
 *
 * Behaviour:
 *   - On app ready (after a short delay so the main window is up),
 *     check for an update silently in the background.
 *   - If one is available, download in the background. The user is
 *     told nothing yet — no popup interrupts their work.
 *   - When the download finishes, surface a non-blocking dialog
 *     asking the user to restart now or later. "Later" leaves the
 *     update queued; it'll install automatically on the next quit.
 *   - The Help menu's "Check for updates…" item routes through the
 *     same flow but, when nothing's available, surfaces a confirmation
 *     dialog so the user knows the check happened.
 *
 * Publishing model: releases are uploaded to
 * https://github.com/caledavis/Magnolia/releases by running
 * `npm run release:mac` (or release:win / release:linux) with the
 * GH_TOKEN env var set to a personal access token that can write
 * releases on the repo. electron-builder uploads the .dmg / .zip /
 * .exe / .AppImage / .deb plus latest*.yml manifests.
 *
 * Dev mode: electron-updater no-ops automatically when running from
 * `electron-vite dev` (because there's no app.asar to compare versions
 * against), so this module is safe to import unconditionally.
 */
import { app, BrowserWindow, dialog, Notification, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

/**
 * Workaround for a Squirrel.Mac bug on modern macOS (see electron #25626).
 * After quitAndInstall(), Squirrel *submits* the ShipIt launchd job
 * (`<appId>.ShipIt`) but never *starts* it — `launchctl print` shows runs=0,
 * "never exited" — so the staged update is never applied and the app doesn't
 * relaunch. We start the job ourselves while the app is still alive; ShipIt
 * then waits for this process to exit and performs the install + relaunch.
 * (A manual `launchctl start` reliably completes the otherwise-stuck install.)
 * The job label is the electron-builder appId + ".ShipIt".
 */
function startShipItJob(): void {
  if (process.platform !== 'darwin') return
  try {
    // launchctl start returns immediately (fire-and-forget); it does not block
    // until the job finishes, so this can't deadlock against ShipIt waiting on
    // us to quit.
    execFileSync('/bin/launchctl', ['start', 'com.magnolia.app.ShipIt'])
  } catch {
    // No job submitted (nothing staged) or already running — nothing to do.
  }
}

let mainWindowRef: BrowserWindow | null = null
let manualCheckInProgress = false
// Where the in-progress manual check was triggered from. 'menu' (Help →
// "Check for updates…") reports its outcome via native dialogs; 'preferences'
// reports inline in the Preferences pane via the 'update:status' channel.
let manualCheckSource: 'menu' | 'preferences' = 'menu'
// Called right before quitAndInstall() so the main process can mark itself as
// intentionally quitting (otherwise the window's `closed` handler re-opens the
// Welcome screen and the macOS update can't install — see below).
let onQuitForUpdateRef: (() => void) | null = null
// Set once an update has been downloaded + staged. Lets the app-quit handlers
// kick ShipIt for the "Later → install on quit" path, which on macOS goes
// through the native Squirrel.Mac auto-install and hits the same
// submitted-but-never-started ShipIt bug as quitAndInstall.
let updateDownloaded = false
let quitHandlersAdded = false
let ipcHandlersAdded = false

/** Persisted updater state (currently just the version the user chose to skip)
 *  lives in its own small file in userData, kept separate from user
 *  preferences so the two can't clobber each other. */
function updateStatePath(): string {
  return join(app.getPath('userData'), 'magnolia-update-state.json')
}
function getSkippedVersion(): string | null {
  try {
    const p = updateStatePath()
    if (existsSync(p)) return (JSON.parse(readFileSync(p, 'utf-8')).skippedVersion as string) ?? null
  } catch {
    /* ignore — treat as nothing skipped */
  }
  return null
}
function setSkippedVersion(version: string): void {
  try {
    writeFileSync(updateStatePath(), JSON.stringify({ skippedVersion: version }, null, 2))
  } catch {
    /* ignore */
  }
}

/** Report a manual-check outcome inline to the Preferences pane. No-op if the
 *  main window is gone. Used only for 'preferences'-sourced checks; 'menu'
 *  checks use native dialogs instead. */
function sendUpdateStatus(status: {
  state: 'checking' | 'up-to-date' | 'available' | 'error' | 'dev-disabled'
  version?: string
  message?: string
}): void {
  const win = mainWindowRef
  if (win && !win.isDestroyed()) win.webContents.send('update:status', status)
}

// ---------------------------------------------------------------------------
// Update-available badge
//
// A lightweight "is a newer version published?" check that works on EVERY
// build — including the portable Windows exe, where electron-updater can't
// install and its check is unreliable. We fetch the published latest*.yml from
// GitHub Releases and compare versions ourselves, independent of whether this
// build can self-update. electron-updater still owns the *install* action where
// supported; this only answers "should we nudge the user?". Best-effort and
// silent on any failure (offline, rate-limited, asset missing).
// ---------------------------------------------------------------------------

export interface UpdateBadgeState {
  available: boolean
  latestVersion: string | null
  currentVersion: string
}

let badgeState: UpdateBadgeState = { available: false, latestVersion: null, currentVersion: '' }

/** The release manifest electron-builder publishes per platform; all carry the
 *  same `version:` line for a given release, so any one answers "what's latest". */
function latestManifestName(): string {
  if (process.platform === 'darwin') return 'latest-mac.yml'
  if (process.platform === 'linux') return 'latest-linux.yml'
  return 'latest.yml'
}

/** Numeric dotted-version compare. >0 if a>b, <0 if a<b, 0 if equal. Strips a
 *  leading 'v' and any prerelease suffix (we ship a single stable channel). */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

function setBadgeState(next: UpdateBadgeState): void {
  badgeState = next
  const win = mainWindowRef
  if (win && !win.isDestroyed()) win.webContents.send('update:badge', next)
}

/** Current badge state, for the renderer to read on mount (before any push). */
export function getUpdateBadgeState(): UpdateBadgeState {
  return badgeState
}

/** Re-evaluate the badge: fetch the latest published version, compare to this
 *  build, and raise the badge if it's newer and not skipped. Silent on failure. */
export async function refreshUpdateBadge(): Promise<void> {
  const currentVersion = app.getVersion()

  // Dev-only override for testing the badge UI without a real newer release or
  // a working network. Set MAGNOLIA_FORCE_UPDATE_BADGE to force the badge on;
  // an optional version string is used as the "latest" label (else a stub).
  // Guarded by !app.isPackaged so it can never fire in a shipped build.
  if (!app.isPackaged && process.env.MAGNOLIA_FORCE_UPDATE_BADGE) {
    const forced = process.env.MAGNOLIA_FORCE_UPDATE_BADGE
    const latestVersion = /^\d/.test(forced) ? forced : '99.0.0'
    setBadgeState({ available: true, latestVersion, currentVersion })
    return
  }

  try {
    const url = `https://github.com/caledavis/Magnolia/releases/latest/download/${latestManifestName()}`
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return
    const text = await res.text()
    const match = text.match(/^version:\s*([0-9][^\s]*)/m)
    if (!match) return
    const latestVersion = match[1].trim()
    const newer = compareVersions(latestVersion, currentVersion) > 0
    const skipped = getSkippedVersion() === latestVersion
    setBadgeState({ available: newer && !skipped, latestVersion, currentVersion })
  } catch {
    /* offline / rate-limited / asset missing — leave the badge as-is */
  }
}

/** electron-updater's releaseNotes is either the release body (a markdown
 *  string) or, with fullChangelog on, an array of {version, note}. Normalise
 *  to a single markdown string for the renderer to render. */
function normalizeReleaseNotes(
  notes: string | Array<{ version: string; note: string | null }> | null | undefined
): string {
  if (!notes) return ''
  if (typeof notes === 'string') return notes
  return notes.map((n) => (n.version ? `## ${n.version}\n\n${n.note ?? ''}` : n.note ?? '')).join('\n\n')
}

/** Apply the staged update now: flag the intentional quit (so the Welcome
 *  screen doesn't reappear), ask Squirrel to install, then kick ShipIt (which
 *  Squirrel submits but won't start on modern macOS). */
function installUpdateNow(): void {
  onQuitForUpdateRef?.()
  autoUpdater.quitAndInstall()
  startShipItJob()
}

/** Initialise the updater and schedule a startup check. Must be
 *  called after app.whenReady() resolves. The reference to the main
 *  window lets us route dialogs through it (so they sit above the
 *  app rather than alone in the dock). */
export function initAutoUpdater(mainWindow: BrowserWindow, onQuitForUpdate: () => void): void {
  mainWindowRef = mainWindow
  onQuitForUpdateRef = onQuitForUpdate
  badgeState = { available: false, latestVersion: null, currentVersion: app.getVersion() }

  // "Later → install on quit": when the app quits with a staged update,
  // Squirrel.Mac is meant to install it on quit, but it hits the same
  // submitted-but-never-started ShipIt bug as quitAndInstall. Kick the job
  // ourselves as the app shuts down. Guarded by updateDownloaded so a normal
  // quit (nothing staged) does nothing; idempotent so it's harmless if the
  // Restart-now path already kicked, or if both will-quit and quit fire.
  if (!quitHandlersAdded) {
    quitHandlersAdded = true
    const kickShipItOnQuit = (): void => {
      if (updateDownloaded) startShipItJob()
    }
    app.on('will-quit', kickShipItOnQuit)
    app.on('quit', kickShipItOnQuit)
  }

  // Buttons in the renderer's update dialog route back through here.
  if (!ipcHandlersAdded) {
    ipcHandlersAdded = true
    ipcMain.on('update:install', () => installUpdateNow())
    ipcMain.on('update:skip', (_e, version: string) => {
      setSkippedVersion(version)
      // Skipping the latest version clears the nudge badge for it.
      if (badgeState.latestVersion === version) {
        setBadgeState({ ...badgeState, available: false })
      }
    })
    ipcMain.on('update:remind-later', () => {
      // No-op: the update stays staged. It re-prompts on the next check and
      // still installs on quit via autoInstallOnAppQuit.
    })
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Suppress prerelease pickup. We're on a single stable channel for
  // 1.0; revisit when there's a beta channel to surface.
  autoUpdater.allowPrerelease = false

  autoUpdater.on('update-available', (info) => {
    // Silent; the download proceeds in the background. For a manual check
    // from the Preferences pane, surface the "available" result inline right
    // away — the download then completes and the Sparkle modal handles install.
    console.log('[auto-update] available:', info.version)
    if (manualCheckInProgress && manualCheckSource === 'preferences') {
      sendUpdateStatus({ state: 'available', version: info.version })
    }
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('[auto-update] up to date:', info.version)
    if (manualCheckInProgress) {
      manualCheckInProgress = false
      if (manualCheckSource === 'preferences') {
        sendUpdateStatus({ state: 'up-to-date', version: info.version })
      } else {
        dialog.showMessageBox(mainWindowRef ?? undefined as any, {
          type: 'info',
          message: 'Magnolia is up to date',
          detail: `Version ${info.version} is the latest available.`,
          buttons: ['OK']
        })
      }
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('[auto-update] error:', err)
    if (manualCheckInProgress) {
      manualCheckInProgress = false
      if (manualCheckSource === 'preferences') {
        sendUpdateStatus({ state: 'error', message: err?.message ?? String(err) })
      } else {
        dialog.showMessageBox(mainWindowRef ?? undefined as any, {
          type: 'error',
          message: 'Could not check for updates',
          detail: err?.message ?? String(err),
          buttons: ['OK']
        })
      }
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    const wasManual = manualCheckInProgress
    manualCheckInProgress = false
    updateDownloaded = true

    // Respect "Skip This Version" for automatic checks; a manual
    // "Check for updates…" always surfaces the prompt regardless.
    if (!wasManual && getSkippedVersion() === info.version) {
      console.log('[auto-update] version skipped by user:', info.version)
      return
    }

    // Subtle OS notification — non-blocking, won't pull focus mid-session.
    if (Notification.isSupported()) {
      new Notification({
        title: 'Magnolia update ready',
        body: `Version ${info.version} is ready to install.`
      }).show()
    }

    const payload = {
      version: info.version,
      currentVersion: app.getVersion(),
      releaseDate: (info as { releaseDate?: string }).releaseDate ?? null,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes)
    }

    // The renderer shows the Sparkle-style modal (release notes + Skip /
    // Remind Me Later / Install Now) and routes the chosen action back via IPC.
    const win = mainWindowRef
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-available', payload)
    } else {
      // No main window to host the modal (e.g. only the Welcome window is up) —
      // fall back to a native prompt so the update can't be silently lost.
      dialog
        .showMessageBox(undefined as never, {
          type: 'info',
          message: `Magnolia ${info.version} is ready to install`,
          detail: 'Restart now to apply the update, or quit later — it installs automatically.',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          cancelId: 1
        })
        .then(({ response }) => {
          if (response === 0) installUpdateNow()
        })
    }
  })

  // Don't block startup: give the app a few seconds to settle before
  // hitting the network.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[auto-update] startup check failed:', err)
    })
    // Independent nudge-badge check, run on every build (electron-updater's
    // own check above no-ops on builds that can't self-install).
    refreshUpdateBadge()
  }, 5_000)
}

/** Triggered by the Help → "Check for updates…" menu item ('menu') or the
 *  Preferences → Updates pane ('preferences'). Same flow as the startup check,
 *  but with user-visible feedback when nothing's available so the user knows
 *  the check happened. 'menu' reports via native dialogs; 'preferences' reports
 *  inline through the 'update:status' channel. */
export function checkForUpdatesManually(source: 'menu' | 'preferences' = 'menu'): void {
  if (!app.isPackaged) {
    if (source === 'preferences') {
      sendUpdateStatus({ state: 'dev-disabled' })
    } else {
      dialog.showMessageBox(mainWindowRef ?? undefined as any, {
        type: 'info',
        message: 'Update checks are disabled in development',
        detail: 'Run a packaged build (`npm run package:mac/win/linux`) to test the update flow.',
        buttons: ['OK']
      })
    }
    return
  }
  // Keep the nudge badge in sync with an explicit user-initiated check.
  refreshUpdateBadge()
  manualCheckInProgress = true
  manualCheckSource = source
  autoUpdater.checkForUpdates().catch((err) => {
    manualCheckInProgress = false
    console.error('[auto-update] manual check failed:', err)
    if (source === 'preferences') {
      sendUpdateStatus({ state: 'error', message: err?.message ?? String(err) })
    } else {
      dialog.showMessageBox(mainWindowRef ?? undefined as any, {
        type: 'error',
        message: 'Could not check for updates',
        detail: err?.message ?? String(err),
        buttons: ['OK']
      })
    }
  })
}
