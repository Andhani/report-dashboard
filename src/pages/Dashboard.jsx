import { Link } from "react-router-dom";
import { useStorage } from "../hooks/useStorage";
import { getMonthSlots } from "../utils/dateUtils";

const FLOW_CARDS = [
  {
    id: "flow1",
    to: "/flow1",
    title: "Flow 1 — Traffic Import",
    description:
      "Upload GSC + GA4 per-URL files. Auto-detect, merge, VLOOKUP, export.",
    icon: "📥",
  },
  {
    id: "flow2",
    to: "/flow2",
    title: "Flow 2 — Traffic Overview",
    description:
      "Upload GSC Chart + GA4 summary files. Aggregate segment-level metrics.",
    icon: "📊",
  },
  {
    id: "flow3",
    to: "/flow3",
    title: "Flow 3 — Leads Summary",
    description:
      "Computed automatically from Flow 1 + Flow 2. No uploads needed.",
    icon: "🎯",
  },
];

export default function Dashboard() {
  const [flow1Data] = useStorage("flow1_data", {});
  const [flow2Data] = useStorage("flow2_data", {});
  const [flow1Window] = useStorage("flow1_window", null);
  const [flow2Window] = useStorage("flow2_window", null);
  const [bcUrls] = useStorage("bc_urls", []);
  const [blogUrls] = useStorage("blog_urls", []);

  const flow1Slots = flow1Window ? getMonthSlots(flow1Window, 6) : [];
  const flow2Slots = flow2Window ? getMonthSlots(flow2Window, 6) : [];

  const flow1FilledBC = flow1Slots.filter(
    (s) =>
      (flow1Data[`bc_gsc_dijual_${s.key}`] ||
        flow1Data[`bc_gsc_disewa_${s.key}`]) &&
      flow1Data[`bc_ga4_${s.key}`],
  ).length;
  const flow1FilledBlog = flow1Slots.filter(
    (s) => flow1Data[`blog_gsc_${s.key}`] && flow1Data[`blog_ga4_${s.key}`],
  ).length;
  const flow2Filled = flow2Slots.filter(
    (s) => flow2Data[`ga4_free_${s.key}`],
  ).length;

  return (
    <div className="space-y-8">
      {/* Setup status bar */}
      <SetupStatus
        bcUrls={bcUrls}
        blogUrls={blogUrls}
        flow1Window={flow1Window}
        flow2Window={flow2Window}
      />

      {/* Flow cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {FLOW_CARDS.map((card) => (
          <div
            key={card.id}
            className="card p-6 border-l-[3px] border-l-accent"
          >
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-xl mb-4">
              {card.icon}
            </div>
            <h3 className="text-base font-semibold text-gray-900 leading-tight mb-2">
              {card.title}
            </h3>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              {card.description}
            </p>
            <Link
              to={card.to}
              className="btn bg-accent text-white hover:bg-accent-dark shadow-card hover:shadow-card-hover"
            >
              Open
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          </div>
        ))}
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
        <Link
          to="/urls"
          className="card p-4 flex items-center gap-4 hover:border-accent/30 transition-colors group"
        >
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl group-hover:bg-accent/5">
            🔗
          </div>
          <div>
            <div className="font-medium text-sm text-gray-900">URL Lists</div>
            <div className="text-xs text-gray-500">
              {bcUrls.length} BC · {blogUrls.length} Blog URLs stored
            </div>
          </div>
        </Link>
        <Link
          to="/settings"
          className="card p-4 flex items-center gap-4 hover:border-accent/30 transition-colors group"
        >
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl group-hover:bg-accent/5">
            ⚙️
          </div>
          <div>
            <div className="font-medium text-sm text-gray-900">Settings</div>
            <div className="text-xs text-gray-500">
              OAuth, rolling window, Sheets URL
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

function SetupStatus({ bcUrls, blogUrls, flow1Window, flow2Window }) {
  const steps = [
    { label: "BC URL list", done: bcUrls.length > 0, link: "/urls" },
    { label: "Blog URL list", done: blogUrls.length > 0, link: "/urls" },
    { label: "Flow 1 window", done: !!flow1Window, link: "/settings" },
    { label: "Flow 2 window", done: !!flow2Window, link: "/settings" },
  ];
  const allDone = steps.every((s) => s.done);

  if (allDone) return null;

  return (
    <div className="card p-4 bg-warning/10 border-warning/30">
      <div className="flex items-start gap-3">
        <span className="text-warning text-sm mt-0.5">⚠️</span>
        <div>
          <div className="font-medium text-ink mb-2">
            Complete setup to get started
          </div>
          <div className="flex flex-wrap gap-3">
            {steps.map((step) => (
              <Link
                key={step.label}
                to={step.link}
                className="flex items-center gap-1.5 text-sm"
              >
                {step.done ? (
                  <span className="w-5 h-5 rounded-full bg-success flex items-center justify-center text-white text-xs">
                    ✓
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded-full bg-warning/20 border-2 border-warning" />
                )}
                <span
                  className={
                    step.done ? "text-success line-through" : "text-ink"
                  }
                >
                  {step.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlotGrid({ title, slots, data, type }) {
  // Flow 1: BC GSC needs dijual+disewa keys; others are simple
  const ROWS =
    type === "flow1"
      ? [
          {
            label: "BC GSC",
            status: (k) => {
              const d = !!data[`bc_gsc_dijual_${k}`];
              const s = !!data[`bc_gsc_disewa_${k}`];
              if (d && s) return "green";
              if (d || s) return "yellow";
              return "gray";
            },
          },
          {
            label: "BC GA4",
            status: (k) => (data[`bc_ga4_${k}`] ? "green" : "gray"),
          },
          {
            label: "Blog GSC",
            status: (k) => (data[`blog_gsc_${k}`] ? "green" : "gray"),
          },
          {
            label: "Blog GA4",
            status: (k) => (data[`blog_ga4_${k}`] ? "green" : "gray"),
          },
        ]
      : [
          {
            label: "GSC Chart (All)",
            status: (k) => (data[`gsc_all_organic_${k}`] ? "green" : "gray"),
          },
          {
            label: "GA4 Free-form",
            status: (k) => (data[`ga4_free_${k}`] ? "green" : "gray"),
          },
          {
            label: "GA4 Leads",
            status: (k) => (data[`ga4_leads_${k}`] ? "green" : "gray"),
          },
        ];

  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-gray-900 leading-tight mb-4">
        {title}
      </h2>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr>
              <th className="text-left text-gray-500 font-medium pb-3 pr-4 w-36">
                Source
              </th>
              {slots.map((s) => (
                <th
                  key={s.key}
                  className="text-center text-gray-500 font-medium pb-3 px-2 min-w-[70px]"
                >
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {ROWS.map((row) => (
              <tr key={row.label}>
                <td className="py-2 pr-4 text-gray-700 font-medium text-sm">
                  {row.label}
                </td>
                {slots.map((s) => {
                  const st = row.status(s.key);
                  return (
                    <td key={s.key} className="py-2 px-2 text-center">
                      <span
                        className={
                          st === "green"
                            ? "badge-green"
                            : st === "yellow"
                              ? "badge-yellow"
                              : "badge-gray"
                        }
                      >
                        {st === "green" ? "●" : st === "yellow" ? "◐" : "○"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="badge-green">●</span> Complete
        </span>
        <span className="flex items-center gap-1.5">
          <span className="badge-yellow">◐</span> Partial
        </span>
        <span className="flex items-center gap-1.5">
          <span className="badge-gray">○</span> Empty
        </span>
      </div>
    </div>
  );
}
