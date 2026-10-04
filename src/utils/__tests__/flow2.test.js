import { describe, it, expect } from "vitest";
import { parseGA4File, getFlow2DataKey } from "../parseFlow2";
import {
  computeFlow2Output,
  mergeFlow1Reuse,
  buildFlow2CSV,
  withSheetLabels,
  METRICS,
  ENTRY_METRICS,
} from "../computeFlow2";
import { SEGMENTS } from "../flow2Segments";

/**
 * A GA4 export as the UI receives it: five banner lines, a blank, the header
 * row, the grand total, then the data rows.
 */
function ga4Csv({ title, range = "20260401-20260430", header, total, rows }) {
  return [
    "# ----------------------------------------",
    "# BRIGHTON",
    `# ${title}`,
    `# ${range}`,
    "# ----------------------------------------",
    "",
    header.join(","),
    [...total, "Grand total"].join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\n");
}

const PATH_TRAFFIC_HEADER = [
  "Session source/medium",
  "Page path and screen class",
  "Views",
  "Active users",
  "Sessions",
  "Average engagement time per session",
];
const PATH_EVENT_HEADER = [
  "Session source/medium",
  "Page path and screen class",
  "Active users",
  "Sessions",
  "Event count",
];
const ENTRY_TRAFFIC_HEADER = [
  "Landing page + query string",
  "Views",
  "Active users",
  "Sessions",
  "Average engagement time per session",
];
const ENTRY_EVENT_HEADER = [
  "Landing page + query string",
  "Active users",
  "Sessions",
  "Event count",
];

const org = (path, ...metrics) => ["google / organic", path, ...metrics];

describe("parseGA4File — export classification", () => {
  it("reads a segment-filtered event export off its grand total", () => {
    const result = parseGA4File(
      ga4Csv({
        title: "Report - Event Page Path-Event Disewa",
        header: PATH_EVENT_HEADER,
        total: ["", "", 680, 741, 1271],
        rows: [org("/disewa", 51, 53, 80), org("/disewa/gudang", 4, 4, 5)],
      }),
    );

    expect(result).toMatchObject({
      type: "ga4_event",
      dimension: "path",
      segment: "disewa",
      month: { year: 2026, month: 4 },
      users: 680,
      sessions: 741,
      eventCount: 1271,
    });
    expect(getFlow2DataKey(result)).toBe("ga4_leads_disewa_2026-04");
  });

  it("routes a landing-page export to the Via Entry keys", () => {
    const traffic = parseGA4File(
      ga4Csv({
        title: "Report - Traffic Session + Event Entry-Dijual",
        header: ENTRY_TRAFFIC_HEADER,
        total: ["", 209293, 24663, 32055, 149.71],
        rows: [
          ["/dijual", 5432, 300, 409, 345.57],
          ["/dijual/rumah/malang", 2949, 164, 174, 395.87],
          ["/dijual?query=&page=3", 1, 0, 1, 0],
        ],
      }),
    );
    expect(traffic).toMatchObject({
      type: "ga4_entry_traffic",
      dimension: "entry",
      segment: "dijual",
      views: 209293,
    });
    expect(getFlow2DataKey(traffic)).toBe("ga4_entry_dijual_2026-04");

    const event = parseGA4File(
      ga4Csv({
        title: "Report - Traffic Session + Event Entry-Dijual - Leads",
        header: ENTRY_EVENT_HEADER,
        total: ["", 1351, 1505, 4684],
        rows: [
          ["/dijual", 26, 30, 93],
          ["/dijual/rumah/medan", 8, 8, 25],
          ["/dijual/rumah/kediri", 7, 7, 18],
        ],
      }),
    );
    expect(getFlow2DataKey(event)).toBe("ga4_entry_leads_dijual_2026-04");
    expect(event.eventCount).toBe(4684);
  });

  it("recognises agent profiles by their single-slug URLs", () => {
    const result = parseGA4File(
      ga4Csv({
        title: "Report - Traffic Page Path-Asumsi Agent Profil Traffic",
        header: PATH_TRAFFIC_HEADER,
        total: ["", "", 25883, 4463, 7672, 77.49],
        rows: [
          org("/adelince", 184, 23, 31, 121.51),
          org("/wennylestari", 183, 14, 30, 135.56),
          org("/develinlido", 133, 15, 19, 141.26),
        ],
      }),
    );
    expect(result.segment).toBe("agent_profile");
    expect(getFlow2DataKey(result)).toBe("ga4_agent_profile_2026-04");
  });

  it("tells /dijualsewa/ apart from /dijual/", () => {
    const result = parseGA4File(
      ga4Csv({
        title: "Report - Traffic Page Path",
        header: PATH_TRAFFIC_HEADER,
        total: ["", "", 900, 500, 600, 60],
        rows: [
          org("/dijualsewa", 300, 150, 200, 60),
          org("/dijualsewa/rumah/malang", 300, 150, 200, 60),
          org("/dijualsewa/ruko/solo", 300, 200, 200, 60),
        ],
      }),
    );
    expect(result.segment).toBe("dijualsewa");
  });

  it("uses the report title to separate Perumahan Baru from its detail pages", () => {
    const rows = [
      org("/perumahan-baru/viewdetail/a", 100, 50, 60, 30),
      org("/perumahan-baru/viewdetail/b", 100, 50, 60, 30),
      org("/perumahan-baru/viewdetail/c", 100, 50, 60, 30),
    ];
    const detail = parseGA4File(
      ga4Csv({
        title: "Report - Traffic Page Path-Viewdetail",
        header: PATH_TRAFFIC_HEADER,
        total: ["", "", 300, 150, 180, 30],
        rows,
      }),
    );
    expect(detail.segment).toBe("perumahan_baru_detail");

    const all = parseGA4File(
      ga4Csv({
        title: "Report - Traffic Page Path-Perumahan Baru",
        header: PATH_TRAFFIC_HEADER,
        total: ["", "", 300, 150, 180, 30],
        rows,
      }),
    );
    expect(all.segment).toBe("perumahan_baru");
  });

  it("splits an all-segments export across the blocks it covers", () => {
    const result = parseGA4File(
      ga4Csv({
        title: "Report - Traffic Page Path",
        header: PATH_TRAFFIC_HEADER,
        total: ["", "", 1000, 400, 500, 90],
        rows: [
          org("/dijual/rumah/malang", 100, 40, 50, 60),
          org("/disewa/ruko/solo", 200, 60, 80, 120),
          org("/cari-properti/view/123", 50, 20, 25, 30),
          org("/articles-all/tips", 80, 30, 40, 20),
          org("/agent/surabaya", 40, 10, 20, 45),
          org("/perumahan-baru/listing", 60, 25, 30, 50),
          org("/perumahan-baru/viewdetail/x", 90, 35, 45, 70),
          org("/kevinhartono", 30, 12, 15, 25),
        ],
      }),
    );

    expect(result.segment).toBeNull();
    expect(getFlow2DataKey(result)).toBe("ga4_free_2026-04");
    expect(result.all_organic.views).toBe(1000);
    expect(result.segments.dijual.views).toBe(100);
    expect(result.segments.cari_properti_view.views).toBe(50);
    expect(result.segments.agent_profile.views).toBe(30);
    // The whole /perumahan-baru/ area covers its detail pages too, which is
    // how the sheet reports the two blocks.
    expect(result.segments.perumahan_baru.views).toBe(150);
    expect(result.segments.perumahan_baru_detail.views).toBe(90);
    // AET is a per-session average, so the split weights it by sessions.
    expect(result.segments.perumahan_baru.aet_seconds).toBeCloseTo(
      (50 * 30 + 70 * 45) / 75,
      6,
    );
  });
});

describe("computeFlow2Output", () => {
  const slots = [{ key: "2026-04", label: "Apr 2026", year: 2026, month: 4 }];

  it("derives both ratios from the block's own Active Users", () => {
    const out = computeFlow2Output(
      {
        "ga4_dijual_2026-04": {
          views: 165278,
          users: 23821,
          sessions: 40474,
          aet_seconds: 92,
        },
        "ga4_leads_dijual_2026-04": {
          users: 1240,
          sessions: 1357,
          eventCount: 4081,
        },
      },
      slots,
    )["dijual"]["2026-04"];

    expect(out.leadPerUser).toBeCloseTo(4081 / 23821, 10);
    expect(out.userConvRate).toBeCloseTo(1240 / 23821, 10);
    // 17.13% and 5.21% — the figures in the report.
    expect((out.leadPerUser * 100).toFixed(2)).toBe("17.13");
    expect((out.userConvRate * 100).toFixed(2)).toBe("5.21");
  });

  it("leaves a metric with no export behind it null, not zero", () => {
    const out = computeFlow2Output({}, slots)["dijual"]["2026-04"];
    for (const metric of METRICS) expect(out[metric.id]).toBeNull();
  });

  it("still reads event imports stored under the pre-rename shape", () => {
    const out = computeFlow2Output(
      {
        "ga4_dijual_2026-04": { views: 1000, users: 500, sessions: 600 },
        "ga4_leads_dijual_2026-04": { clickContactAgent: 50 },
      },
      slots,
    )["dijual"]["2026-04"];

    expect(out.eventPurchase).toBe(50);
    expect(out.leadPerUser).toBeCloseTo(0.1, 10);
    // That shape never carried converting users, so the row stays blank.
    expect(out.convUsers).toBeNull();
    expect(out.userConvRate).toBeNull();
  });

  it("falls back to the all-segments split when a segment has no file", () => {
    const out = computeFlow2Output(
      {
        "ga4_free_2026-04": {
          all_organic: { views: 1000, users: 400, sessions: 500 },
          segments: { blog: { views: 80, users: 30, sessions: 40 } },
        },
      },
      slots,
    );
    expect(out.blog["2026-04"].views).toBe(80);
    expect(out.all_organic["2026-04"].views).toBe(1000);
  });
});

describe("withSheetLabels", () => {
  const slots = [
    { key: "2026-04", label: "Apr 2026", year: 2026, month: 4 },
    { key: "2026-09", label: "Sep 2026", year: 2026, month: 9 },
  ];

  it("marks a month the exports only partly cover", () => {
    const labelled = withSheetLabels(
      {
        "ga4_free_2026-04": { days: { start: 1, end: 30 } },
        "ga4_free_2026-09": { days: { start: 1, end: 18 } },
      },
      slots,
    );
    expect(labelled[0].sheetLabel).toBeUndefined();
    expect(labelled[1].sheetLabel).toBe("Sep (1-18)");
  });
});

describe("buildFlow2CSV — sheet layout", () => {
  const slots = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"].map((m, i) => ({
    key: `2026-0${4 + i}`,
    label: `${m} 2026`,
    year: 2026,
    month: 4 + i,
  }));

  const BLOCK = Object.fromEntries(SEGMENTS.map((s, i) => [s.id, i * 8]));
  const ROW_SEGMENT_HEADERS = 1;
  const ROW_MONTHS = 2;
  const ROW_FIRST_METRIC = 3;
  const ROW_ENTRY_HEADERS = 16;
  const ROW_FIRST_ENTRY_METRIC = 17;

  it("places every block where the report has it", () => {
    const grid = buildFlow2CSV(computeFlow2Output({}, slots), slots);

    expect(grid).toHaveLength(26);
    expect(grid[0]).toHaveLength(79);

    // Banner, then the two header rows.
    expect(grid[0][0]).toMatch(/Do not change anything/);
    expect(grid[ROW_SEGMENT_HEADERS][1]).toBe("All Organic Traffic");
    expect(grid[ROW_SEGMENT_HEADERS][8]).toBe(
      "Segment /dijual/ Traffic\nListing Secondary",
    );
    expect(grid[ROW_SEGMENT_HEADERS][24]).toBe(
      "All /cari-properti/view/ Traffic\nDetail Page Secondary",
    );
    expect(grid[ROW_SEGMENT_HEADERS][40]).toBe("Asumsi Agent Profile Traffic");
    expect(grid[ROW_SEGMENT_HEADERS][72]).toBe(
      "All /dijualsewa/ Traffic\nListing Page Dijualsewa",
    );
    expect(grid[ROW_MONTHS][1]).toBe("Apr");
    expect(grid[ROW_MONTHS][78]).toBe("Sep");

    // Twelve metric rows per block, in report order.
    METRICS.forEach((metric, r) => {
      expect(grid[ROW_FIRST_METRIC + r][0]).toBe(metric.label);
      expect(grid[ROW_FIRST_METRIC + r][BLOCK.dijualsewa]).toBe(metric.label);
    });
    expect(grid[ROW_FIRST_METRIC + 11][0]).toBe("AVG Rank");

    // A blank row, then the Via Entry table under its three blocks only.
    expect(grid[15].every((c) => c === "")).toBe(true);
    expect(grid[ROW_ENTRY_HEADERS][8]).toBe("Via Entry - All /dijual/ Traffic");
    expect(grid[ROW_ENTRY_HEADERS][16]).toBe(
      "Via Entry - All /disewa/ Traffic",
    );
    expect(grid[ROW_ENTRY_HEADERS][32]).toBe(
      "Via Entry - All /articles-all/ Traffic",
    );
    expect(grid[ROW_ENTRY_HEADERS][0]).toBe("");
    expect(grid[ROW_ENTRY_HEADERS][24]).toBe("");
    ENTRY_METRICS.forEach((metric, r) => {
      expect(grid[ROW_FIRST_ENTRY_METRIC + r][8]).toBe(metric.label);
    });
  });

  it("writes each value into its segment's month column", () => {
    const output = computeFlow2Output(
      {
        "gsc_disewa_2026-05": {
          clicks: 26559,
          impressions: 340042,
          avgPosition: 7.5,
        },
        "ga4_entry_dijual_2026-04": {
          views: 186659,
          users: 23821,
          sessions: 30039,
          aet_seconds: 142,
        },
        "ga4_entry_leads_dijual_2026-04": {
          users: 1240,
          sessions: 1357,
          eventCount: 4081,
        },
      },
      slots,
    );
    const grid = buildFlow2CSV(output, slots);

    // /disewa/ block, May column: clicks, impressions, AVG Rank.
    expect(grid[ROW_FIRST_METRIC][BLOCK.disewa + 2]).toBe("26,559");
    expect(grid[ROW_FIRST_METRIC + 1][BLOCK.disewa + 2]).toBe("340,042");
    expect(grid[ROW_FIRST_METRIC + 11][BLOCK.disewa + 2]).toBe("7.5");
    // Months with no import stay blank rather than reading as a zero.
    expect(grid[ROW_FIRST_METRIC][BLOCK.disewa + 1]).toBe("");

    // Via Entry /dijual/ block, Apr column.
    expect(grid[ROW_FIRST_ENTRY_METRIC][BLOCK.dijual + 1]).toBe("186,659");
    expect(grid[ROW_FIRST_ENTRY_METRIC + 3][BLOCK.dijual + 1]).toBe("0:02:22");
    expect(grid[ROW_FIRST_ENTRY_METRIC + 4][BLOCK.dijual + 1]).toBe("1,240");
    expect(grid[ROW_FIRST_ENTRY_METRIC + 6][BLOCK.dijual + 1]).toBe("4,081");
    expect(grid[ROW_FIRST_ENTRY_METRIC + 7][BLOCK.dijual + 1]).toBe("17.13%");
    expect(grid[ROW_FIRST_ENTRY_METRIC + 8][BLOCK.dijual + 1]).toBe("5.21%");
  });
});

describe("Flow 3 interop", () => {
  it("gets the same lead rates from the old and new event shapes", async () => {
    const { computeBCLeads } = await import("../computeFlow3");
    const { slots, bcUrls, flow1Data, flow2Data } = await import("./fixtures");
    const sep = slots[1];
    const range = { startDay: null, endDay: null };

    // Flow 2 now stores the site-wide event total under all_organic, with the
    // event renamed; Flow 3's lead rates must not notice either change.
    const renamed = {
      ...flow2Data,
      "ga4_leads_2026-09": {
        all_organic: { users: 900, sessions: 1000, eventCount: 1250 },
        segments: {},
      },
    };

    const before = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, range);
    const after = computeBCLeads(bcUrls, flow1Data, renamed, sep, range);

    expect(after.rates).toEqual(before.rates);
    expect(after.rates.leadPerViews).toBeGreaterThan(0);
  });
});

describe("Flow 1 reuse", () => {
  const slots = [{ key: "2026-04", label: "Apr 2026", year: 2026, month: 4 }];

  // Flow 1 stores URL rows plus the aggregates taken from the export's own
  // Chart/grand-total rows; Flow 2 reads the aggregates.
  const flow1Data = {
    "bc_gsc_dijual_2026-04": {
      chartAgg: { clicks: 39913, impressions: 696775, avgPosition: 7.0 },
      rows: [],
    },
    "bc_ga4_dijual_2026-04": {
      grandTotal: {
        views: 165278,
        users: 29307,
        sessions: 40474,
        aet_seconds: 92,
      },
      rows: [],
    },
    "blog_gsc_2026-04": {
      chartAgg: { clicks: 58144, impressions: 7225752, avgPosition: 4.4 },
      rows: [],
    },
  };

  it("fills the /dijual/ and blog blocks without a second upload", () => {
    const out = computeFlow2Output(mergeFlow1Reuse(flow1Data, {}), slots);

    expect(out.dijual["2026-04"]).toMatchObject({
      clicks: 39913,
      impressions: 696775,
      avgRank: 7,
      views: 165278,
      users: 29307,
    });
    expect(out.blog["2026-04"].clicks).toBe(58144);
    // Segments Flow 1 knows nothing about are untouched by the reuse.
    expect(out.perumahan_baru["2026-04"].clicks).toBeNull();
  });

  it("lets a file uploaded to Flow 2 win over the Flow 1 copy", () => {
    const out = computeFlow2Output(
      mergeFlow1Reuse(flow1Data, {
        "gsc_dijual_2026-04": {
          clicks: 1,
          impressions: 2,
          avgPosition: 3,
        },
      }),
      slots,
    );
    expect(out.dijual["2026-04"].clicks).toBe(1);
  });
});
