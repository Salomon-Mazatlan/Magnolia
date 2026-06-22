import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { readFile, writeFile, stat, unlink } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { basename, dirname, join } from 'path'
import JSZip from 'jszip'
import { readQdpx } from './qdpx/reader'
import { writeQdpx, EmptyProjectGuardError, createEmptyProjectFile } from './qdpx/writer'
import { serializeCodebook } from './qdpx/codebook-serializer'
import { deserializeCodebook } from './qdpx/codebook-deserializer'
import type { Project, Code } from '../renderer/models/types'

// Path to the .qdpx currently open in the renderer, set via the
// 'set-active-project-path' IPC whenever the renderer's project file
// changes. Used to self-heal media temp files: the reader extracts each
// PDF / image / audio / video binary to a temp file named `<guid>.<ext>`
// and the viewers read those on demand. If the OS reaps a temp file
// mid-session (sleep/wake, aggressive cleaners, age-out), the read would
// fail and the viewer would go blank. Instead we regenerate the temp file
// from the source bytes still inside the open .qdpx — the archive is the
// source of truth, temp is just a disposable cache. (Stage 2 will remove
// the temp round-trip entirely; this keeps the cache honest in the
// meantime with no change to any viewer.)
let activeProjectPath: string | null = null

/** Regenerate a reaped media temp file from the open .qdpx. Reader-created
 *  temp files are named `<guid>.<ext>`, so the source guid is the temp
 *  basename; we pull `sources/<guid>.<ext>` out of the archive, rewrite the
 *  temp file in place (so later reads hit the fast path), and return the
 *  bytes. Returns null when the bytes can't be recovered — no open project,
 *  the path isn't guid-keyed (a fresh import temp, which won't have been
 *  reaped), or the binary genuinely isn't in the archive. */
async function regenerateMediaTemp(filePath: string): Promise<Buffer | null> {
  if (!activeProjectPath) return null
  const file = basename(filePath)
  const dotAt = file.lastIndexOf('.')
  const guid = dotAt > 0 ? file.slice(0, dotAt) : file
  try {
    const zip = await JSZip.loadAsync(await readFile(activeProjectPath))
    let entry = zip.file(`sources/${file}`)
    if (!entry) {
      // Extension may differ from the temp file's (e.g. an older export) —
      // match any non-text `sources/<guid>.*` entry.
      const prefix = `sources/${guid}.`
      const altName = Object.keys(zip.files).find(
        (n) => n.startsWith(prefix) && !zip.files[n].dir && !n.toLowerCase().endsWith('.txt')
      )
      if (altName) entry = zip.file(altName)
    }
    if (!entry) return null
    const buf = await entry.async('nodebuffer')
    // Re-cache the temp file so subsequent reads avoid the unzip. Best
    // effort: if this fails we still return the bytes we recovered.
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      await writeFile(filePath, buf)
    } catch { /* couldn't re-cache; bytes returned below regardless */ }
    return buf
  } catch {
    return null
  }
}

/** Read a media temp file, self-healing from the open .qdpx if the OS has
 *  reaped it. Throws the original ENOENT only when the bytes are genuinely
 *  unrecoverable, so callers' existing "file not available" handling is
 *  preserved. */
async function readMediaFile(filePath: string): Promise<Buffer> {
  try {
    return await readFile(filePath)
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e
    const regenerated = await regenerateMediaTemp(filePath)
    if (regenerated) return regenerated
    throw e
  }
}

/** Paper sizes offered in Preferences, mapped to Electron printToPDF
 *  `pageSize` strings. */
type ExportPaperSize = 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid'
const VALID_PAPER_SIZES = new Set<ExportPaperSize>(['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'])

/** Read the user's chosen export paper size from the persisted
 *  preferences file. Read at export time (rather than passed from the
 *  renderer) so every export call site honours it without change.
 *  Falls back to A4 — the Preferences default — on any miss. */
async function readExportPaperSize(): Promise<ExportPaperSize> {
  try {
    const prefsPath = join(app.getPath('userData'), 'magnolia-preferences.json')
    if (existsSync(prefsPath)) {
      const prefs = JSON.parse(await readFile(prefsPath, 'utf-8'))
      if (typeof prefs?.paperSize === 'string' && VALID_PAPER_SIZES.has(prefs.paperSize as ExportPaperSize)) {
        return prefs.paperSize as ExportPaperSize
      }
    }
  } catch { /* ignore — fall back to default */ }
  return 'A4'
}

export function registerIpcHandlers(): void {
  ipcMain.handle('get-file-size', async (_event, filePath: string) => {
    try {
      const s = await stat(filePath)
      return s.size
    } catch {
      return null
    }
  })

  ipcMain.handle('read-pdf-file', async (_event, filePath: string) => {
    // Return raw PDF bytes as a Uint8Array. Electron's structured clone
    // sends this as-is without base64 overhead, which is much faster than
    // passing a base64 string through contextBridge. Self-heals from the
    // open .qdpx if the temp copy was reaped.
    const buffer = await readMediaFile(filePath)
    return new Uint8Array(buffer)
  })

  // Record which .qdpx the renderer currently has open, so the media read
  // handlers can regenerate reaped temp files from it on demand.
  ipcMain.handle('set-active-project-path', (_event, filePath: string | null) => {
    activeProjectPath = filePath || null
  })

  ipcMain.handle('open-project', async (event) => {
    const result = await dialog.showOpenDialog({
      title: 'Open QDPX Project',
      filters: [{ name: 'QDPX Projects', extensions: ['qdpx'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const data = await readQdpx(filePath, (stage, current, total) => {
      event.sender.send('project-load-progress', { stage, current, total })
    })
    return { ...data, filePath }
  })

  // Show the file picker and return the chosen path without doing any
  // load work. Lets the renderer separate "user picks a file" from
  // "loading begins" — important because the loading overlay used to
  // appear before the picker, making it look like Magnolia stalled
  // before the picker even opened.
  ipcMain.handle('pick-project-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open QDPX Project',
      filters: [{ name: 'QDPX Projects', extensions: ['qdpx'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'save-project',
    async (
      _event,
      data: {
        project: Project
        sourceContents: Record<string, string>
        filePath?: string
      }
    ) => {
      let filePath = data.filePath
      if (!filePath) {
        const result = await dialog.showSaveDialog({
          title: 'Save QDPX Project',
          defaultPath: `${data.project.name}.qdpx`,
          filters: [{ name: 'QDPX Projects', extensions: ['qdpx'] }]
        })
        if (result.canceled || !result.filePath) return null
        filePath = result.filePath
      }
      try {
        await writeQdpx(filePath, data.project, data.sourceContents)
      } catch (e) {
        if (e instanceof EmptyProjectGuardError) {
          console.warn('[save-project guard]', e.message)
          return { guardBlocked: true, message: e.message }
        }
        throw e
      }
      return filePath
    }
  )

  ipcMain.handle('create-new-project-file', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Create New Project',
      defaultPath: 'Untitled.qdpx',
      filters: [{ name: 'QDPX Projects', extensions: ['qdpx'] }]
    })
    if (result.canceled || !result.filePath) return null
    const filePath = result.filePath
    try {
      const projectName = await createEmptyProjectFile(filePath)
      return { filePath, projectName }
    } catch (err) {
      dialog.showErrorBox('Failed to create project', String(err))
      return null
    }
  })

  ipcMain.handle('save-project-as', async (_event, data: { project: Project; sourceContents: Record<string, string>; currentFilePath?: string }) => {
    const result = await dialog.showSaveDialog({
      title: 'Save QDPX Project As',
      defaultPath: `${data.project.name}.qdpx`,
      filters: [{ name: 'QDPX Projects', extensions: ['qdpx'] }]
    })
    if (result.canceled || !result.filePath) return null
    try {
      // Carry imported binaries forward from the project that's currently
      // open (a different path than the Save As target), so reaped temp
      // copies don't get dropped when the project moves to a new file.
      await writeQdpx(result.filePath, data.project, data.sourceContents, {
        carryForwardFrom: data.currentFilePath
      })
    } catch (e) {
      if (e instanceof EmptyProjectGuardError) {
        console.warn('[save-project-as guard]', e.message)
        return { guardBlocked: true, message: e.message }
      }
      throw e
    }
    return result.filePath
  })

  ipcMain.handle('open-project-path', async (event, filePath: string) => {
    const data = await readQdpx(filePath, (stage, current, total) => {
      event.sender.send('project-load-progress', { stage, current, total })
    })
    return { ...data, filePath }
  })

  // Supported document extensions — add new formats here
  const SUPPORTED_EXTENSIONS = ['txt', 'md', 'markdown', 'pdf', 'docx', 'rtf', 'odt', 'doc', 'csv', 'xlsx', 'wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'heic', 'heif', 'mp4', 'mov', 'avi']
  const BINARY_EXTENSIONS = new Set(['pdf', 'docx', 'rtf', 'odt', 'doc', 'xlsx', 'wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'heic', 'heif', 'mp4', 'mov', 'avi'])
  const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'])
  const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
  // TIFF + HEIC are accepted but decoded to PNG on import — Chromium
  // can't render them natively, so we normalise at the boundary and
  // the rest of the app just sees a PNG.
  const DECODED_IMAGE_EXTENSIONS = new Set(['tif', 'tiff', 'heic', 'heif'])
  const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi'])
  const IMAGE_MIME: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp'
  }
  const VIDEO_MIME: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo'
  }

  async function readDocumentFile(fp: string): Promise<{ name: string; content: string; extension: string; formatting?: any }> {
    const ext = fp.split('.').pop()?.toLowerCase() || ''
    const name = basename(fp)

    if (BINARY_EXTENSIONS.has(ext)) {
      const buffer = await readFile(fp)
      if (ext === 'pdf') {
        const { extractPdfText } = await import('./pdf-extract')
        const result = await extractPdfText(buffer)
        return { name, content: result.text, extension: 'pdf', formatting: { pdfBase64: result.pdfBase64, pdfPageOffsets: result.pageOffsets } }
      }
      if (ext === 'docx') {
        const { convertDocxToPdf } = await import('./docx-convert')
        const result = await convertDocxToPdf(buffer)
        return { name, content: result.text, extension: 'pdf', formatting: { pdfBase64: result.pdfBase64, pdfPageOffsets: result.pageOffsets } }
      }
      if (ext === 'rtf') {
        const { convertRtfToPdf } = await import('./rtf-convert')
        const result = await convertRtfToPdf(buffer)
        return { name, content: result.text, extension: 'pdf', formatting: { pdfBase64: result.pdfBase64, pdfPageOffsets: result.pageOffsets } }
      }
      if (ext === 'odt') {
        const { convertOdtToPdf } = await import('./odt-convert')
        const result = await convertOdtToPdf(buffer)
        return { name, content: result.text, extension: 'pdf', formatting: { pdfBase64: result.pdfBase64, pdfPageOffsets: result.pageOffsets } }
      }
      if (ext === 'doc') {
        // Legacy Word binary format — no viable pure-JS parser. Tell
        // the user to resave as .docx rather than silently failing.
        throw new Error('Legacy Microsoft Word .doc files aren\'t supported. Please open the file in Word and save it as .docx.')
      }
      if (ext === 'xlsx') {
        // Convert to CSV at the boundary so the existing survey-import
        // pipeline (which expects CSV text) handles it unchanged. The
        // renderer keeps the .xlsx extension so it knows to route the
        // file through queueSurveyImport.
        const { convertXlsxToCsv } = await import('./xlsx-convert')
        const csv = convertXlsxToCsv(buffer)
        return { name, content: csv, extension: 'xlsx' }
      }
      if (IMAGE_EXTENSIONS.has(ext) || DECODED_IMAGE_EXTENSIONS.has(ext)) {
        // Write image to temp file — renderer loads via IPC + Blob URL,
        // matching the audio pattern (avoids huge base64 in memory).
        // For TIFF / HEIC we decode to PNG first so the rest of the
        // pipeline only ever sees natively-renderable formats.
        let finalBuffer = buffer
        let finalExt = ext
        let finalMime = IMAGE_MIME[ext] || 'application/octet-stream'
        if (DECODED_IMAGE_EXTENSIONS.has(ext)) {
          const { convertTiffToPng, convertHeicToPng } = await import('./image-convert')
          const converted = ext === 'tif' || ext === 'tiff'
            ? convertTiffToPng(buffer)
            : await convertHeicToPng(buffer)
          finalBuffer = converted.buffer
          finalExt = converted.ext
          finalMime = converted.mimeType
        }
        const tempDir = join(app.getPath('temp'), 'magnolia-images')
        if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
        const tempId = basename(fp, '.' + ext) + '-' + Date.now()
        const tempPath = join(tempDir, tempId + '.' + finalExt)
        await writeFile(tempPath, finalBuffer)
        return {
          name,
          content: '',
          extension: finalExt,
          formatting: {
            imageFilePath: tempPath,
            mimeType: finalMime,
            imageExt: finalExt
          }
        }
      }
      if (VIDEO_EXTENSIONS.has(ext)) {
        let duration = 0
        try {
          const { extractVideoMetadata } = await import('./video-extract')
          const meta = await extractVideoMetadata(fp, ext)
          duration = meta.duration
        } catch (err) {
          console.error('Video metadata extraction failed, using defaults:', err)
        }
        const tempDir = join(app.getPath('temp'), 'magnolia-videos')
        if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
        const tempId = basename(fp, '.' + ext) + '-' + Date.now()
        const tempPath = join(tempDir, tempId + '.' + ext)
        await writeFile(tempPath, buffer)
        return {
          name,
          content: '',
          extension: ext,
          formatting: {
            videoFilePath: tempPath,
            mimeType: VIDEO_MIME[ext] || 'video/mp4',
            duration,
            videoExt: ext
          }
        }
      }
      if (AUDIO_EXTENSIONS.has(ext)) {
        const AUDIO_MIME: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac' }
        let duration = 0, channels = 1, sampleRate = 44100
        try {
          const { extractAudioMetadata } = await import('./audio-extract')
          const metadata = await extractAudioMetadata(fp, ext)
          duration = metadata.duration
          channels = metadata.channels
          sampleRate = metadata.sampleRate
        } catch (err) {
          console.error('Audio metadata extraction failed, using defaults:', err)
        }
        // Write audio to temp file — renderer loads via file:// URL to avoid huge base64 in memory
        const tempDir = join(app.getPath('temp'), 'magnolia-audio')
        if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
        const tempId = basename(fp, '.' + ext) + '-' + Date.now()
        const tempPath = join(tempDir, tempId + '.' + ext)
        await writeFile(tempPath, buffer)
        return {
          name,
          content: '',
          extension: ext,
          formatting: {
            audioFilePath: tempPath,
            mimeType: AUDIO_MIME[ext.toLowerCase()] || 'audio/wav',
            duration,
            channels,
            sampleRate
          }
        }
      }
    }

    return { name, content: await readFile(fp, 'utf-8'), extension: ext }
  }

  /**
   * Read a batch of document paths, isolating per-file errors so one
   * bad file (unsupported format, corrupt bytes) doesn't blow up the
   * whole import. The renderer surfaces any `.error` entries via a
   * user-facing alert.
   */
  async function readDocumentBatch(
    paths: string[]
  ): Promise<Array<{ name: string; content: string; extension: string; formatting?: any } | { name: string; error: string }>> {
    return Promise.all(
      paths.map(async (fp) => {
        const name = basename(fp)
        try {
          return await readDocumentFile(fp)
        } catch (err: any) {
          return { name, error: err?.message || String(err) }
        }
      })
    )
  }

  ipcMain.handle('import-text-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Document',
      filters: [{ name: 'Supported Documents', extensions: SUPPORTED_EXTENSIONS }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return readDocumentBatch(result.filePaths)
  })

  ipcMain.handle('read-text-files', async (_event, filePaths: string[]) => {
    const acceptedExts = SUPPORTED_EXTENSIONS.map((e) => '.' + e)
    const validPaths = filePaths.filter((fp) => acceptedExts.some((ext) => fp.toLowerCase().endsWith(ext)))
    if (validPaths.length === 0) return null
    return readDocumentBatch(validPaths)
  })

  // Read an audio file and return as ArrayBuffer for blob URL creation in
  // renderer. Self-heals from the open .qdpx if the temp copy was reaped.
  ipcMain.handle('read-audio-file', async (_event, filePath: string) => {
    const buffer = await readMediaFile(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  // Read an image file and return as ArrayBuffer for blob URL creation in
  // renderer. Self-heals from the open .qdpx if the temp copy was reaped.
  ipcMain.handle('read-image-file', async (_event, filePath: string) => {
    const buffer = await readMediaFile(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  // Read a video file and return as ArrayBuffer for blob URL creation in
  // renderer. Self-heals from the open .qdpx if the temp copy was reaped.
  ipcMain.handle('read-video-file', async (_event, filePath: string) => {
    const buffer = await readMediaFile(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  ipcMain.handle('import-transcript', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Transcript',
      filters: [
        { name: 'Text Files', extensions: ['txt', 'md', 'markdown', 'srt', 'vtt'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const fp = result.filePaths[0]
    const content = await readFile(fp, 'utf-8')
    return { name: basename(fp), content }
  })

  ipcMain.handle(
    'export-pdf',
    async (
      _event,
      html: string,
      defaultName: string,
      dialogTitle?: string,
      headerTemplate?: string,
      footerTemplate?: string
    ) => {
      const result = await dialog.showSaveDialog({
        title: dialogTitle || 'Export as PDF',
        defaultPath: `${defaultName}.pdf`,
        filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return null

      // Write the HTML to a temp file and loadFile it. A data: URL would
      // cap at ~2MB in Chromium, and exports with embedded base64
      // thumbnails (query results over PDF / image sources) easily go
      // past that, silently dropping the images from the output.
      const tempDir = join(app.getPath('temp'), 'magnolia-pdf-export')
      if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
      const tempHtmlPath = join(tempDir, `export-${Date.now()}.html`)
      await writeFile(tempHtmlPath, html, 'utf-8')

      const win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: { sandbox: true }
      })

      try {
        await win.loadFile(tempHtmlPath)
        // Brief delay to let any remaining image decodes settle.
        await new Promise((resolve) => setTimeout(resolve, 300))
        // When a header is supplied, bump the top margin so the
        // header HTML fits above the body content without overlap.
        // Same for footer at the bottom. Chromium's printToPDF
        // requires displayHeaderFooter=true to render either; we
        // also pass empty placeholders for the opposite slot so
        // Chromium's default URL/date/page-number headers don't show.
        const hasHeader = !!headerTemplate
        const hasFooter = !!footerTemplate
        const displayHeaderFooter = hasHeader || hasFooter
        const pdfBuffer = await win.webContents.printToPDF({
          pageSize: await readExportPaperSize(),
          printBackground: true,
          margins: {
            // When a header/footer template is supplied, the page
            // margin doubles as that template's vertical canvas — so
            // give it ~0.95" of room. This also keeps the brand mark
            // well clear of the unprintable strip on most printers.
            top: hasHeader ? 0.95 : 0.5,
            bottom: hasFooter ? 0.95 : 0.5,
            left: 0.5,
            right: 0.5
          },
          ...(displayHeaderFooter
            ? {
                displayHeaderFooter: true,
                headerTemplate: headerTemplate || '<span></span>',
                footerTemplate: footerTemplate || '<span></span>'
              }
            : {})
        })
        await writeFile(result.filePath, pdfBuffer)
        return result.filePath
      } finally {
        win.close()
        try { await unlink(tempHtmlPath) } catch { /* best effort */ }
      }
    }
  )

  ipcMain.handle('export-codebook', async (_event, codes: Code[]) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Codebook',
      defaultPath: 'Codebook.qdc',
      filters: [{ name: 'REFI-QDA Codebook', extensions: ['qdc'] }]
    })
    if (result.canceled || !result.filePath) return null
    const xml = serializeCodebook(codes)
    await writeFile(result.filePath, xml, 'utf-8')
    return result.filePath
  })

  ipcMain.handle('import-codebook', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Codebook',
      filters: [{ name: 'REFI-QDA Codebook', extensions: ['qdc'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const xml = await readFile(result.filePaths[0], 'utf-8')
    return deserializeCodebook(xml)
  })
}
