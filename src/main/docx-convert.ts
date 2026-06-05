/**
 * DOCX → PDF conversion pipeline.
 * 1. mammoth converts DOCX buffer → HTML
 * 2. Electron's printToPDF renders the HTML as a PDF buffer
 * 3. The result feeds into the existing extractPdfText pipeline
 */
import mammoth from 'mammoth'
import { extractPdfText, type PdfExtractResult } from './pdf-extract'
import { htmlToPdfBuffer } from './html-to-pdf'

/**
 * Convert a DOCX buffer to PDF and extract text.
 * Returns the same result shape as extractPdfText — the downstream
 * code treats it as a regular PDF import.
 */
export async function convertDocxToPdf(buffer: Buffer): Promise<PdfExtractResult> {
  // Step 1: Convert DOCX → HTML using mammoth
  const result = await mammoth.convertToHtml({ buffer })
  const html = result.value

  // Step 2: Render HTML → PDF using a hidden BrowserWindow
  const pdfBuffer = await htmlToPdfBuffer(html)

  // Step 3: Extract text + base64 from the PDF buffer
  return extractPdfText(pdfBuffer)
}
