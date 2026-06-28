import { secondsToHmmss } from './dateUtils'

/**
 * 4 segments in display order.
 */
export const SEGMENTS = [
  { id: 'all_organic', label: 'All Organic Traffic' },
  { id: 'dijual',      label: 'All /dijual/ Traffic' },
  { id: 'disewa',      label: 'All /disewa/ Traffic' },
  { id: 'blog',        label: 'Blog Traffic' },
]

/**
 * 9 metrics per segment (last 2 only on All Organic).
 */
export const METRICS = [
  { id: 'clicks',             label: 'Total Clicks (GSC)',        source: 'gsc',  allOnly: false },
  { id: 'impressions',        label: 'Total Impressions (GSC)',   source: 'gsc',  allOnly: false },
  { id: 'views',              label: 'Total Views (GA4)',         source: 'ga4',  allOnly: false },
  { id: 'users',              label: 'Total Active Users (GA4)', source: 'ga4',  allOnly: false },
  { id: 'sessions',           label: 'Total Sessions (GA4)',     source: 'ga4',  allOnly: false },
  { id: 'aet',                label: 'AVG AET (GA4)',            source: 'ga4',  allOnly: false },
  { id: 'avgPosition',        label: 'AVG Position (GSC)',       source: 'gsc',  allOnly: false },
  { id: 'clickContactAgent',  label: 'Click_Contact_Agent',      source: 'leads', allOnly: true },
  { id: 'leadPerViews',       label: 'Lead per Views',           source: 'calc', allOnly: true },
]

/**
 * Compute the full overview table from stored flow2Data.
 *
 * Returns: {
 *   segments: {
 *     [segId]: {
 *       [monthKey]: { clicks, impressions, views, users, sessions, aet, avgPosition, clickContactAgent, leadPerViews }
 *     }
 *   }
 * }
 */
export function computeFlow2Output(flow2Data, slots) {
  const result = {}

  for (const seg of SEGMENTS) {
    result[seg.id] = {}
    for (const slot of slots) {
      const mk = slot.key

      // GSC Chart data — stored per segment
      const gscKey = `gsc_${seg.id}_${mk}`
      const gsc = flow2Data[gscKey]

      // GA4 Free-form — one file per month, sub-segment values pre-computed
      const ga4Free = flow2Data[`ga4_free_${mk}`]

      // GA4 Leads — always all_organic
      const leads = flow2Data[`ga4_leads_${mk}`]

      // GA4 values: all_organic comes from grand total, others from filtered sums
      const ga4 = ga4Free ? (seg.id === 'all_organic' ? ga4Free.all_organic : ga4Free[seg.id]) : null

      const clicks      = gsc?.clicks ?? 0
      const impressions = gsc?.impressions ?? 0
      const avgPosition = gsc?.avgPosition ?? 0
      const views       = ga4?.views ?? 0
      const users       = ga4?.users ?? 0
      const sessions    = ga4?.sessions ?? 0
      const aet_seconds = ga4?.aet_seconds ?? 0
      const clickContactAgent = seg.id === 'all_organic' ? (leads?.clickContactAgent ?? 0) : null
      const leadPerViews = seg.id === 'all_organic' && views > 0 && clickContactAgent
        ? clickContactAgent / views
        : null

      result[seg.id][mk] = {
        clicks,
        impressions,
        views,
        users,
        sessions,
        aet: aet_seconds,
        avgPosition,
        clickContactAgent,
        leadPerViews,
      }
    }
  }

  return result
}

/**
 * Format a metric value for display.
 */
export function formatMetricValue(metricId, value) {
  if (value === null || value === undefined) return '—'
  if (value === 0) return '0'
  switch (metricId) {
    case 'aet':         return secondsToHmmss(value)
    case 'avgPosition': return value.toFixed(1)
    case 'leadPerViews': return (value * 100).toFixed(2) + '%'
    case 'clicks':
    case 'impressions':
    case 'views':
    case 'users':
    case 'sessions':
    case 'clickContactAgent': return Math.round(value).toLocaleString()
    default: return String(value)
  }
}

/**
 * Build CSV data for Traffic Overview export.
 * Layout: rows = metrics, columns = segments × months (matching current report).
 */
export function buildFlow2CSV(outputData, slots) {
  // Header row: metric label + "Segment Month" headers
  const headers = ['Metric', ...SEGMENTS.flatMap(seg =>
    slots.map(s => `${seg.label} ${s.label}`)
  )]

  const rows = METRICS.map(metric => {
    const cells = [metric.label]
    for (const seg of SEGMENTS) {
      for (const slot of slots) {
        const val = outputData[seg.id]?.[slot.key]?.[metric.id]
        if (metric.allOnly && seg.id !== 'all_organic') {
          cells.push('N/A')
        } else {
          cells.push(val !== null && val !== undefined ? formatMetricValue(metric.id, val) : '0')
        }
      }
    }
    return cells
  })

  return [headers, ...rows]
}
