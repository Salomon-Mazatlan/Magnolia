/**
 * RFC 4180 CSV parser.
 *
 * Returns rows × columns. Handles:
 *  - Fields quoted with double quotes
 *  - Embedded commas inside quoted fields
 *  - Embedded newlines (LF / CRLF) inside quoted fields
 *  - Doubled double-quotes (`""`) inside quoted fields → literal `"`
 *
 * Whitespace and case are preserved as-is. Empty trailing lines are
 * dropped so a trailing newline doesn't produce a phantom empty row.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let inQuotes = false
  const len = input.length

  while (i < len) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote (`""`) inside a quoted field → emit one quote.
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        // Closing quote.
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    // Outside quotes.
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      // Treat CRLF as a single record terminator; bare CR also flushes.
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      if (input[i] === '\n') i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }

  // Flush the final field/row if the input didn't end on a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Drop a trailing empty row that results from a single trailing
  // newline (very common in exported CSVs).
  while (rows.length > 0) {
    const last = rows[rows.length - 1]
    if (last.length === 1 && last[0] === '') rows.pop()
    else break
  }

  return rows
}
