/**
 * XLSX → CSV conversion.
 *
 * The survey importer expects CSV text, so we convert .xlsx exports to
 * CSV at the main-process boundary. SheetJS's `sheet_to_csv` resolves
 * shared strings, formats date-typed cells using their style numFmt,
 * and CSV-escapes embedded quotes/commas/newlines, which is everything
 * the downstream survey parser needs.
 */
import * as XLSX from 'xlsx'

export function convertXlsxToCsv(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const firstSheetName = wb.SheetNames[0]
  if (!firstSheetName) {
    throw new Error('XLSX file has no worksheets.')
  }
  const sheet = wb.Sheets[firstSheetName]
  return XLSX.utils.sheet_to_csv(sheet, { forceQuotes: false })
}
