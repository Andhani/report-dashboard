import { Link } from "react-router-dom";
import {
  useCloudStorage as useStorage,
  useCloudArrayStorage,
} from "../hooks/useCloudStorage";
import { useDataContext } from "../context/DataContext";
import { getMonthSlots } from "../utils/dateUtils";
import {
  Gauge,
  BarChart2,
  Users,
  Link2,
  Settings,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

const FLOW_CARDS = [
  {
    id: "flow1",
    to: "/traffic-optimized",
    title: "Traffic (Optimized)",
    description:
      "Upload GSC and GA4 Export per project segment to display data per URL. Auto-detected — no need to adjust the export file.",
    Icon: Gauge,
  },
  {
    id: "flow2",
    to: "/traffic-overview",
    title: "Traffic Overview",
    description:
      "Upload GSC and GA4 Export per segment, plus overall site-wide data, to summarize traffic across all segments.",
    Icon: BarChart2,
  },
  {
    id: "flow3",
    to: "/leads-summary",
    title: "Leads Summary",
    description:
      "Computed automatically from Traffic (Optimized) + Traffic Overview. No uploads needed.",
    Icon: Users,
  },
];

export default function Dashboard() {
  const { flow1Data, flow2Data } = useDataContext();
  const [flow1Window] = useStorage("flow1_window", null);
  const [flow2Window] = useStorage("flow2_window", null);
  const [bcUrls] = useCloudArrayStorage("bc_urls", []);
  const [blogUrls] = useCloudArrayStorage("blog_urls", []);

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
    <div className="space-y-6">
      {/* Setup status bar */}
      <SetupStatus
        bcUrls={bcUrls}
        blogUrls={blogUrls}
        flow1Window={flow1Window}
        flow2Window={flow2Window}
      />

      {/* Flow cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {FLOW_CARDS.map((card) => {
          const { Icon } = card;
          return (
            <div key={card.id} className="card p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <Icon
                  size={18}
                  className="text-muted flex-shrink-0"
                  strokeWidth={1.75}
                />
                <h3 className="text-xs font-semibold text-ink leading-tight">
                  {card.title}
                </h3>
              </div>
              <p className="text-xs text-muted leading-snug flex-1">
                {card.description}
              </p>
              <div>
                <Link to={card.to} className="btn-primary">
                  Open
                  <ArrowRight size={13} strokeWidth={2} />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* Slot grids */}
      {flow1Window && (
        <SlotGrid
          title="Traffic (Optimized) — Slot Status Summary"
          slots={flow1Slots}
          data={flow1Data}
          type="flow1"
        />
      )}
      {flow2Window && (
        <SlotGrid
          title="Traffic Overview — Slot Status Summary"
          slots={flow2Slots}
          data={flow2Data}
          extraData={flow1Data}
          type="flow2"
        />
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/urls"
          className="card p-3 flex items-center gap-3 hover:border-border transition-colors group"
        >
          <Link2
            size={18}
            className="text-muted group-hover:text-ink flex-shrink-0"
            strokeWidth={1.75}
          />
          <div className="min-w-0">
            <div className="font-medium text-xs text-ink">URL Lists</div>
            <div className="text-2xs text-muted truncate">
              {bcUrls.length} BC · {blogUrls.length} Blog URLs stored
            </div>
          </div>
        </Link>
        <Link
          to="/settings"
          className="card p-3 flex items-center gap-3 hover:border-border transition-colors group"
        >
          <Settings
            size={18}
            className="text-muted group-hover:text-ink flex-shrink-0"
            strokeWidth={1.75}
          />
          <div className="min-w-0">
            <div className="font-medium text-xs text-ink">Settings</div>
            <div className="text-2xs text-muted truncate">
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
    { label: "BC URLs", done: bcUrls.length > 0, link: "/urls" },
    { label: "Blog URLs", done: blogUrls.length > 0, link: "/urls" },
    { label: "Traffic window", done: !!flow1Window, link: "/settings" },
    { label: "Overview window", done: !!flow2Window, link: "/settings" },
  ];
  const allDone = steps.every((s) => s.done);

  if (allDone) return null;

  return (
    <div className="card p-3 border-warning/40 bg-warning/5">
      <div className="flex items-center gap-3">
        <AlertTriangle
          size={14}
          className="text-warning flex-shrink-0"
          strokeWidth={2}
        />
        <span className="text-xs font-medium text-ink mr-2">Setup needed</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {steps.map((step) => (
            <Link
              key={step.label}
              to={step.link}
              className="flex items-center gap-1.5 text-xs"
            >
              <span className={step.done ? "dot-ok" : "dot-empty"}>●</span>
              <span
                className={step.done ? "text-muted line-through" : "text-ink"}
              >
                {step.label}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function SlotGrid({ title, slots, data, extraData, type }) {
  const ROWS =
    type === "flow1"
      ? [
          {
            label: "BC",
            status: (k) => {
              const dijual = !!data[`bc_gsc_dijual_${k}`];
              const disewa = !!data[`bc_gsc_disewa_${k}`];
              const ga4 = !!data[`bc_ga4_${k}`];
              if (dijual && disewa && ga4) return "ok";
              if (dijual || disewa || ga4) return "pending";
              return "empty";
            },
          },
          {
            label: "Blog",
            status: (k) => {
              const gsc = !!data[`blog_gsc_${k}`];
              const ga4 = !!data[`blog_ga4_${k}`];
              if (gsc && ga4) return "ok";
              if (gsc || ga4) return "pending";
              return "empty";
            },
          },
        ]
      : [
          {
            label: "BC",
            status: (k) => {
              const dijual = !!extraData?.[`bc_gsc_dijual_${k}`];
              const disewa = !!extraData?.[`bc_gsc_disewa_${k}`];
              const ga4 = !!extraData?.[`bc_ga4_${k}`];
              if (dijual && disewa && ga4) return "ok";
              if (dijual || disewa || ga4) return "pending";
              return "empty";
            },
          },
          {
            label: "Blog",
            status: (k) => {
              const gsc = !!extraData?.[`blog_gsc_${k}`];
              const ga4 = !!extraData?.[`blog_ga4_${k}`];
              if (gsc && ga4) return "ok";
              if (gsc || ga4) return "pending";
              return "empty";
            },
          },
          {
            label: "All Organic Traffic",
            status: (k) => {
              const gsc = !!data[`gsc_all_organic_${k}`];
              const ga4Free = !!data[`ga4_free_${k}`];
              const leads = !!data[`ga4_leads_${k}`];
              if (gsc && ga4Free && leads) return "ok";
              if (gsc || ga4Free || leads) return "pending";
              return "empty";
            },
          },
        ];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-ink">{title}</h2>
        <div className="flex items-center gap-4 text-2xs text-muted">
          <span><span className="dot-ok">●</span> filled</span>
          <span><span className="dot-pending">●</span> partial</span>
          <span><span className="dot-empty">●</span> empty</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-muted font-medium text-2xs uppercase tracking-wide pb-2 pr-4 w-40">
                Source
              </th>
              {slots.map((s) => (
                <th
                  key={s.key}
                  className="text-center text-muted font-medium text-2xs uppercase tracking-wide pb-2 px-2 min-w-[64px]"
                >
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ROWS.map((row, ri) => (
              <tr
                key={row.label}
                className={ri % 2 === 1 ? "bg-surface-2/40" : ""}
              >
                <td className="py-2 pr-4 text-xs text-ink font-medium">
                  {row.label}
                </td>
                {slots.map((s) => {
                  const st = row.status(s.key);
                  return (
                    <td
                      key={s.key}
                      className="py-2 px-2 text-center text-sm"
                    >
                      <span className={`dot-${st}`}>●</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
