/**
 * RTF → PDF conversion pipeline.
 * 1. @iarna/rtf-to-html converts the RTF text → HTML (pure JS, preserves
 *    fonts, colours, bold/italic/underline, and tables).
 * 2. Electron's printToPDF renders the HTML as a PDF buffer.
 * 3. The result feeds into the existing extractPdfText pipeline so the
 *    downstream code treats it as a regular PDF import — identical to
 *    what convertDocxToPdf does.
 *
 * Images: @iarna/rtf-to-html emits <img src="data:image/png;base64,…">
 * for `\pict` groups, so embedded images travel straight through to
 * the PDF.
 */
import rtfToHtml from '@iarna/rtf-to-html'
import { extractPdfText, type PdfExtractResult } from './pdf-extract'
import { htmlToPdfBuffer } from './html-to-pdf'

export async function convertRtfToPdf(buffer: Buffer): Promise<PdfExtractResult> {
  const rtfText = buffer.toString('utf-8')

  // Step 1: RTF → HTML (callback-based API, wrap in a Promise).
  const html = await new Promise<string>((resolve, reject) => {
    rtfToHtml.fromString(rtfText, (err: Error | null, out?: string) => {
      if (err) reject(err)
      else if (typeof out !== 'string') reject(new Error('rtf-to-html returned no output'))
      else resolve(out)
    })
  })

  // Step 2: HTML → PDF via shared helper.
  const pdfBuffer = await htmlToPdfBuffer(html)

  // Step 3: Extract text + base64 for the viewer.
  return extractPdfText(pdfBuffer)
}
