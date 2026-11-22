/**
 * RFC 4180 text: every field quoted, rows ended by CRLF. A field that starts like a spreadsheet formula
 * (`=`, `+`, `-`, `@`, tab, CR) gets a leading `'`, so opening the file never runs streamer-typed text.
 */
export function csvText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(csvField).join(",")}\r\n`).join("")
}

function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}
