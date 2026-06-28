import { Link } from 'react-router-dom'
import { useStorage } from '../hooks/useStorage'
import { getMonthSlots } from '../utils/dateUtils'

const FLOW_CARDS = [
  {
    id: 'flow1',
    to: '/flow1',
    title: 'Flow 1 — Traffic Import',
    description: 'Upload GSC + GA4 per-URL files. Auto-detect, merge, VLOOKUP, export.',
    icon: '📥',
    color: 'blue',
  },
  {
    id: 'flow2',
    to: '/flow2',
    title: 'Flow 2 — Traffic Overview',
    description: 'Upload GSC Chart + GA4 summary files. Aggregate segment-level metrics.',
    icon: '📊',
    color: 'purple',
  },
  {
    id: 'flow3',
    to: '/flow3',
    title: 'Flow 3 — Leads Summary',
    description: 'Computed automatically from Flow 1 + Flow 2. No uploads needed.',
    icon: '🎯',
    color: 'green',
  },
]

const colorMap = {
  blue: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: 'bg-blue-100',
    btn: 'bg-blue-600 hover:bg-blue-700',
  },
  purple: {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    icon: 'bg-purple-100',
    btn: 'bg-purple-600 hover:bg-purple-700',
  },
  green: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    icon: 'bg-green-100',
    btn: 'bg-green-600 hover:bg-green-700',
  },
}

export default function Dashboard() {
  const [flow1Data] = useStorage('flow1_data', {})
  const [flow2Data] = useStorage('flow2_data', {})
  const [flow1Window] = useStorage('flow1_window', null)
  const [flow2Window] = useStorage('flow2_window', null)
  const [bcUrls] = useStorage('bc_urls', [])
  const [blogUrls] = useStorage('blog_urls', [])

  const flow1Slots = flow1Window ? getMonthSlots(flow1Window, 6) : []
  const flow2Slots = flow2Window ? getMonthSlots(flow2Window, 8) : []

  const flow1FilledBC = flow1Slots.filter(s => flow1Data[`bc_gsc_${s.key}`] && flow1Data[`bc_ga4_${s.key}`]).length
  const flow1FilledBlog = flow1Slots.filter(s => flow1Data[`blog_gsc_${s.key}`] && flow1Data[`blog_ga4_${s.key}`]).length
  const flow2Filled = flow2Slots.filter(s => flow2Data[s.key]).length

  const flow1Ready = flow1Slots.length > 0 && bcUrls.length > 0 && blogUrls.length > 0
  const flow2Ready = flow2Slots.length > 0
  const flow3Ready = flow1Filled(flow1Data, flow1Slots) && flow2Filled > 0

  return (
    <div className="space-y-8">
      {/* Setup status bar */}
      <SetupStatus bcUrls={bcUrls} blogUrls={blogUrls} flow1Window={flow1Window} flow2Window={flow2Window} />

      {/* Flow cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {FLOW_CARDS.map((card) => {
          const c = colorMap[card.color]
          return (
            <div key={card.id} className={`card p-6 border ${c.border} ${c.bg}`}>
              <div className={`w-12 h-12 rounded-xl ${c.icon} flex items-center justify-center text-2xl mb-4`}>
                {card.icon}
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{card.title}</h3>
              <p className="text-sm text-gray-600 mb-5 leading-relaxed">{card.description}</p>
              <Link
                to={card.to}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${c.btn}`}
              >
                Open
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          )
        })}
      </div>

      {/* Slot grids */}
      {flow1Window && (
        <SlotGrid
          title="Flow 1 Slot Status"
          slots={flow1Slots}
          data={flow1Data}
          type="flow1"
        />
      )}
      {flow2Window && (
        <SlotGrid
          title="Flow 2 Slot Status"
          slots={flow2Slots}
          data={flow2Data}
          type="flow2"
        />
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-4">
        <Link to="/urls" className="card p-4 flex items-center gap-4 hover:border-brand-300 transition-colors group">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl group-hover:bg-brand-50">🔗</div>
          <div>
            <div className="font-medium text-sm text-gray-900">URL Lists</div>
            <div className="text-xs text-gray-500">
              {bcUrls.length} BC · {blogUrls.length} Blog URLs stored
            </div>
          </div>
        </Link>
        <Link to="/settings" className="card p-4 flex items-center gap-4 hover:border-brand-300 transition-colors group">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl group-hover:bg-brand-50">⚙️</div>
          <div>
            <div className="font-medium text-sm text-gray-900">Settings</div>
            <div className="text-xs text-gray-500">OAuth, rolling window, Sheets URL</div>
          </div>
        </Link>
      </div>
    </div>
  )
}

function flow1Filled(data, slots) {
  return slots.some(s => data[`bc_gsc_${s.key}`] || data[`blog_gsc_${s.key}`])
}

function SetupStatus({ bcUrls, blogUrls, flow1Window, flow2Window }) {
  const steps = [
    { label: 'BC URL list', done: bcUrls.length > 0, link: '/urls' },
    { label: 'Blog URL list', done: blogUrls.length > 0, link: '/urls' },
    { label: 'Flow 1 window', done: !!flow1Window, link: '/settings' },
    { label: 'Flow 2 window', done: !!flow2Window, link: '/settings' },
  ]
  const allDone = steps.every(s => s.done)

  if (allDone) return null

  return (
    <div className="card p-4 border-yellow-200 bg-yellow-50">
      <div className="flex items-start gap-3">
        <span className="text-yellow-500 text-lg mt-0.5">⚠️</span>
        <div>
          <div className="font-medium text-yellow-900 mb-2">Complete setup to get started</div>
          <div className="flex flex-wrap gap-3">
            {steps.map((step) => (
              <Link key={step.label} to={step.link} className="flex items-center gap-1.5 text-sm">
                {step.done ? (
                  <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
                ) : (
                  <span className="w-5 h-5 rounded-full bg-yellow-200 border-2 border-yellow-400" />
                )}
                <span className={step.done ? 'text-green-700 line-through' : 'text-yellow-900'}>{step.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SlotGrid({ title, slots, data, type }) {
  const projects = type === 'flow1'
    ? [
        { key: 'bc', label: 'BC', sources: ['gsc', 'ga4'] },
        { key: 'blog', label: 'Blog', sources: ['gsc', 'ga4'] },
      ]
    : [
        { key: 'overview', label: 'Overview', sources: ['gsc', 'ga4_free', 'ga4_leads'] },
      ]

  return (
    <div className="card p-6">
      <h2 className="font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr>
              <th className="text-left text-gray-500 font-medium pb-3 pr-4 w-24">Project</th>
              <th className="text-left text-gray-500 font-medium pb-3 pr-4 w-16">Source</th>
              {slots.map((s) => (
                <th key={s.key} className="text-center text-gray-500 font-medium pb-3 px-2 min-w-[70px]">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {projects.flatMap((proj) =>
              proj.sources.map((src, si) => {
                return (
                  <tr key={`${proj.key}_${src}`}>
                    <td className="py-2 pr-4 text-gray-700 font-medium">
                      {si === 0 ? proj.label : ''}
                    </td>
                    <td className="py-2 pr-4 text-gray-500 uppercase text-xs">{src}</td>
                    {slots.map((s) => {
                      const dataKey = type === 'flow1'
                        ? `${proj.key}_${src}_${s.key}`
                        : `${src}_${s.key}`
                      const filled = !!data[dataKey]
                      return (
                        <td key={s.key} className="py-2 px-2 text-center">
                          <span className={filled ? 'badge-green' : 'badge-gray'}>
                            {filled ? '●' : '○'}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="badge-green">●</span> Filled</span>
        <span className="flex items-center gap-1.5"><span className="badge-gray">○</span> Empty</span>
      </div>
    </div>
  )
}
