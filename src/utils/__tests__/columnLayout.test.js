import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCSVData, buildSheetsValues, computeFlow1Output } from "../computeFlow1";
import { slots, blogUrls, bcUrls, flow1Data } from "./fixtures";

const src = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// Pulls the `key:` order out of an array literal in a source file, so the
// three places that spell out the column order can be compared without
// importing the React pages (importing them boots Firebase).
function keyOrder(source, arrayName) {
  const start = source.indexOf(`const ${arrayName} = [`);
  if (start === -1) throw new Error(`${arrayName} not found`);
  const body = source.slice(start, source.indexOf("\n];", start));
  return [...body.matchAll(/key: "([a-z_]+)"/g)].map((m) => m[1]);
}

describe("Blog column order", () => {
  // The order the source sheet uses. Changing the sheet means changing this
  // line and the three definitions below it — the point of the test is that
  // none of them can be forgotten.
  const EXPECTED = [
    "keyword",
    "url",
    "status",
    "content_type",
    "publish_date",
    "pic",
    "slug",
  ];

  it("matches the source sheet in the URL List tab", () => {
    expect(keyOrder(src("../../pages/UrlManager.jsx"), "BLOG_COLS")).toEqual(
      EXPECTED,
    );
  });

  it("matches the source sheet in the Traffic (Optimized) preview", () => {
    expect(keyOrder(src("../../pages/Flow1.jsx"), "BLOG_URL_COLS")).toEqual(
      EXPECTED,
    );
  });

  it("matches the source sheet in the CSV / Sheets export", () => {
    expect(keyOrder(src("../computeFlow1.js"), "BLOG_URL_FIELDS")).toEqual(
      EXPECTED,
    );
  });
});

describe("BC column order", () => {
  const EXPECTED = [
    "main_keyword",
    "offer",
    "property",
    "url",
    "status",
    "content_type",
    "publish",
    "pic",
    "slug",
  ];

  it("agrees across all three definitions", () => {
    expect(keyOrder(src("../../pages/UrlManager.jsx"), "BC_COLS")).toEqual(EXPECTED);
    expect(keyOrder(src("../../pages/Flow1.jsx"), "BC_URL_COLS")).toEqual(EXPECTED);
    expect(keyOrder(src("../computeFlow1.js"), "BC_URL_FIELDS")).toEqual(EXPECTED);
  });
});

describe("Sheets column layout", () => {
  // Metric columns must begin at I for BC and H for Blog. That offset is just
  // the number of URL columns, so adding or removing one silently shifts
  // every metric in the pushed report.
  // BC gained a Content Type column, so its 9 URL fields push the metric block
  // one to the right. Blog still has 7 fields and stays at H.
  it("leaves BC metrics starting at column J (10th)", () => {
    const headers = buildCSVData("bc", [], slots)[0];
    expect(headers.indexOf("Rank Aug 2026")).toBe(9);
  });

  it("leaves Blog metrics starting at column H (8th)", () => {
    const headers = buildCSVData("blog", [], slots)[0];
    expect(headers.indexOf("Rank Aug 2026")).toBe(7);
  });

  it("keeps each exported value under its own header", () => {
    const rows = computeFlow1Output("blog", blogUrls, flow1Data, slots);
    const [headers, firstRow] = buildCSVData("blog", rows, slots);
    const cell = (label) => firstRow[headers.indexOf(label)];

    expect(cell("Keyword")).toBe("harga rumah jakarta");
    expect(cell("Status")).toBe("Published");
    expect(cell("Content Type")).toBe("Create");
    expect(cell("Publish Date")).toBe("2026-09-03");
    expect(cell("PIC")).toBe("Ali");
    expect(cell("Slug")).toBe("/blog/harga-rumah");
  });

  it("pushes only metric columns, in Rank/Impr/Clicks/CTR/Views/Users/Sessions/AET order", () => {
    const rows = computeFlow1Output("blog", blogUrls, flow1Data, slots);
    // 8 metrics x 2 slots, no URL columns — those are written separately.
    expect(buildSheetsValues(rows)[0]).toEqual([
      0, 4.2, 0, 3400, 0, 120, "0%", "3.5%", 0, 900, 0, 700, 0, 820, "0:00:00", "0:01:35",
    ]);
  });
});

describe("column order does not reach the computation", () => {
  it("computes identical metrics regardless of how the row's keys are ordered", () => {
    const reordered = blogUrls.map((row) => ({
      slug: row.slug,
      publish_date: row.publish_date,
      keyword: row.keyword,
      content_type: row.content_type,
      url: row.url,
      pic: row.pic,
      status: row.status,
      id: row.id,
    }));
    expect(computeFlow1Output("blog", reordered, flow1Data, slots).map((r) => r.metrics))
      .toEqual(computeFlow1Output("blog", blogUrls, flow1Data, slots).map((r) => r.metrics));
  });

  it("joins GSC and GA4 on slug for BC across both segment keys", () => {
    const rows = computeFlow1Output("bc", bcUrls, flow1Data, slots);
    const bySlug = Object.fromEntries(rows.map((r) => [r.urlRow.slug, r.metrics]));
    // dijual and disewa live under separate keys and must both land.
    expect(bySlug["/dijual/rumah-bsd"].clicks).toEqual([0, 60]);
    expect(bySlug["/disewa/apt-scbd"].clicks).toEqual([0, 25]);
    // A slug with no export data reads as zero, never undefined.
    expect(bySlug["/dijual/ruko-kelapa"].views).toEqual([0, 0]);
  });
});
