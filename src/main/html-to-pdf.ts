/**
 * Shared helper: render an HTML string to a PDF buffer using Electron's
 * printToPDF. Used by the DOCX, RTF, and ODT conversion pipelines so
 * they all produce byte-identical PDFs from equivalent HTML.
 */
import { BrowserWindow, app } from 'electron'
import { writeFile, unlink } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { sandbox: true }
  })

  // Wrap the input HTML in a full document with print-safe styling. A
  // permissive CSS baseline preserves fonts / colours / borders from
  // the source document while keeping tables and images readable.
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 12pt;
    line-height: 1.5;
    color: #000;
    max-width: 100%;
    padding: 0;
    margin: 0;
  }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; vertical-align: top; }
  p { margin: 0 0 8px; }
</style>
</head>
<body>${html}</body>
</html>`

  // Write to a temp file and loadFile — a data: URL caps at ~2MB in
  // Chromium, which embedded base64 images from DOCX / ODT / RTF
  // sources easily exceed.
  const tempDir = join(app.getPath('temp'), 'magnolia-html-to-pdf')
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
  const tempHtmlPath = join(tempDir, `convert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`)
  await writeFile(tempHtmlPath, fullHtml, 'utf-8')

  try {
    await win.loadFile(tempHtmlPath)
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true
    })
    return Buffer.from(pdfData)
  } finally {
    win.destroy()
    try { await unlink(tempHtmlPath) } catch { /* best effort */ }
  }
}
