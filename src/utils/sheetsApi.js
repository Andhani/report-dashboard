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
 * Push Flow 3 (Leads Summary) to Google Sheets.
 * Appends (prepends) a new month block to the BC/Blog Leads Summary tab.
 * Strategy: read existing data, prepend new rows, write back.
 */
export async function pushFlow3ToSheets(spreadsheetId, project, csvRows) {
  const token = await getValidToken()
  if (!token) throw new Error('Not connected to Google — go to Settings to connect.')

  const sheetName = project === 'bc' ? 'BC Leads Summary' : 'Blog Leads Summary'
  const nRows = csvRows.length
  const nCols = Math.max(...csvRows.map(r => r.length))
  const endCol = colNum2Letter(nCols)

  // Read current data to find last row
  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${sheetName}'!A1:Z1000`)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const readData = await readRes.json()
  if (readData.error) throw new Error(readData.error.message)

  const existingRows = readData.values || []
  // Prepend new block on top, keep existing rows below
  const combined = [...csvRows, ...existingRows]

  const range = `'${sheetName}'!A1:${colNum2Letter(nCols)}${combined.length}`
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: combined }),
    }
  )
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data
}

/**
 * Push Flow 2 (Traffic Overview) to Google Sheets.
 * Writes the 2D values array to the 'Traffic Overview (BC & Blog)' tab.
 * Layout matches buildFlow2CSV: rows = metrics, columns = segments × months.
 */
export async function pushFlow2ToSheets(spreadsheetId, csvRows) {
  const token = await getValidToken()
  if (!token) throw new Error('Not connected to Google — go to Settings to connect.')

  const sheetName = 'Traffic Overview (BC & Blog)'
  const nRows = csvRows.length
  const nCols = csvRows[0]?.length ?? 1
  const endCol = colNum2Letter(nCols)
  const range = `'${sheetName}'!A1:${endCol}${nRows}`

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: csvRows }),
    }
  )
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data
}

/**
 * Extract spreadsheet ID from a Google Sheets URL.
 */
export function extractSpreadsheetId(url) {
  const m = (url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}
