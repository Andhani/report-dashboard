import { getValidToken } from './googleAuth'

/**
 * Push Flow 1 values to the report spreadsheet.
 * Writes metric columns only (never touches URL list columns).
 *
 * BC: starts at col I (1-based 9), 48 cols → I:BD
 * Blog: starts at col H (1-based 8), 48 cols → H:BC
 */
export async function pushFlow1ToSheets(spreadsheetId, project, valuesArray) {
  const token = await getValidToken()
  if (!token) throw new Error('Not connected to Google — go to Settings to connect.')

  const sheetName = project === 'bc' ? 'BC Traffic (Optimized)' : 'Blog Traffic (Optimized)'
  const startColNum = project === 'bc' ? 9 : 8  // I=9, H=8
  const endColNum = startColNum + 47             // 48 metric columns
  const startRow = 4
  const endRow = startRow + valuesArray.length - 1

  const range = `'${sheetName}'!${colNum2Letter(startColNum)}${startRow}:${colNum2Letter(endColNum)}${endRow}`

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: valuesArray }),
    }
  )

  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data
}

/**
 * Convert 1-based column number to A1 letter notation.
 * 1→A, 26→Z, 27→AA, 56→BD
 */
function colNum2Letter(n) {
  let result = ''
  while (n > 0) {
    n--
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26)
  }
  return result
}

/**
 * Extract spreadsheet ID from a Google Sheets URL.
 */
export function extractSpreadsheetId(url) {
  const m = (url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}
