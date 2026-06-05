import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { readFile, writeFile, stat, unlink } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { basename, join } from 'path'
import { readQdpx } from './qdpx/reader'
import { writeQdpx, EmptyProjectGuardError, createEmptyProjectFile } from './qdpx/writer'
import { serializeCodebook } from './qdpx/codebook-serializer'
import { deserializeCodebook } from './qdpx/codebook-deserializer'
import type { Project, Code } from '../renderer/models/types'

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
    // passing a base64 string through contextBridge.
    const buffer = await readFile(filePath)
    return new Uint8Array(buffer)
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

  ipcMain.handle('save-project-as', async (_event, data: { project: Project; sourceContents: Record<string, string> }) => {
    const result = await dialog.showSaveDialog({
      title: 'Save QDPX Project As',
      defaultPath: `${data.project.name}.qdpx`,
      filters: [{ name: 'QDPX Projects', extensions: ['qdpx'] }]
    })
    if (result.canceled || !result.filePath) return null
    try {
      await writeQdpx(result.filePath, data.project, data.sourceContents)
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

  // Read an audio file and return as ArrayBuffer for blob URL creation in renderer
  ipcMain.handle('read-audio-file', async (_event, filePath: string) => {
    const buffer = await readFile(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  // Read an image file and return as ArrayBuffer for blob URL creation in renderer
  ipcMain.handle('read-image-file', async (_event, filePath: string) => {
    const buffer = await readFile(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  // Read a video file and return as ArrayBuffer for blob URL creation in renderer
  ipcMain.handle('read-video-file', async (_event, filePath: string) => {
    const buffer = await readFile(filePath)
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
