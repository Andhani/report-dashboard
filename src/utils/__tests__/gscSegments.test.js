import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  segmentFromFilterValue,
  detectGSCSegment,
  SEGMENTS_BY_ID,
} from "../flow2Segments";
import { parseFlow1Workbook, getDataKey } from "../parseFlow1";
import { parseGSCChartWorkbook, getFlow2DataKey } from "../parseFlow2";

/**
 * The Page filter values Search Console actually writes, taken verbatim from
 * one month's exports. Every one of these is a raw regex — the segment name
 * is never followed by the trailing slash the old matcher looked for, which
 * is what made Traffic (Optimized) skip every BC and Blog file.
 */
const FILTERS = {
  dijual: String.raw`+/dijual(/|\?|$)`,
  disewa: String.raw`+/disewa(/|\?|$)`,
  blog: String.raw`+/articles-all(/|\?|$)`,
  disewaAnchored: String.raw`+^https://www\.brighton\.co\.id/disewa`,
  dijualsewaAnchored: String.raw`+^https://www\.brighton\.co\.id/dijualsewa`,
  perumahanBaru: String.raw`+^https://www\.brighton\.co\.id/perumahan-baru(/?$|/(?:[^v/]|v[^i/]|vi[^e/]|vie[^w/]|view[^d/]|viewd[^e/]|viewde[^t/]|viewdet[^a/]|viewdeta[^i/]|viewdetai[^l/]|viewdetail[^/]))`,
  detailPrimary: "+/perumahan-baru/viewdetail/",
  detailSecondary: "+/cari-properti/view/",
  // Both agent exports are defined by exclusion: the pattern lists what is
  // kept OUT, so the segments named inside it are the ones the file is not.
  agent: String.raw`-(^http:|^https?://(?:[a-vx-z0-9-]|w[a-vx-z0-9-]|ww[a-vx-z0-9-]|w{1,2}\.|www[a-z0-9-])|brighton\.co\.id/?$|brighton\.co\.id/(?:[^a/]|a[^g/]|ag[^e/]|age[^n/]|agen[^t/]|agent[^/])|brighton\.co\.id/agent/(login|agentregistration|listlisting))`,
  agentProfile: String.raw`-(^http:|^https?://(?:[a-vx-z0-9-]|w{1,2}\.)|brighton\.co\.id/?$|brighton\.co\.id/[^/]+/|/(dijual|disewa|bisnisproperti|visitor|perumahan-baru|titip-jual-properti|about|agent|login|search|articles-all|hubungi))`,
};

describe("segmentFromFilterValue", () => {
  it("reads a segment out of each include-filter style GSC emits", () => {
    expect(segmentFromFilterValue(FILTERS.dijual)).toBe("dijual");
    expect(segmentFromFilterValue(FILTERS.disewa)).toBe("disewa");
    expect(segmentFromFilterValue(FILTERS.blog)).toBe("blog");
    expect(segmentFromFilterValue(FILTERS.disewaAnchored)).toBe("disewa");
    expect(segmentFromFilterValue(FILTERS.dijualsewaAnchored)).toBe("dijualsewa");
    expect(segmentFromFilterValue(FILTERS.perumahanBaru)).toBe("perumahan_baru");
    expect(segmentFromFilterValue(FILTERS.detailPrimary)).toBe(
      "perumahan_baru_detail",
    );
    expect(segmentFromFilterValue(FILTERS.detailSecondary)).toBe(
      "cari_properti_view",
    );
  });

  it("still reads the older prose filters", () => {
    expect(segmentFromFilterValue("URL contains /dijual/")).toBe("dijual");
    expect(segmentFromFilterValue("URL contains /articles-all/")).toBe("blog");
  });

  it("reads nothing out of an exclusion filter", () => {
    // The agent-profile pattern names a dozen segments it is excluding;
    // reading any of them as the file's own segment is how it used to be
    // filed under Perumahan Baru, on top of the real Perumahan Baru export.
    expect(segmentFromFilterValue(FILTERS.agentProfile)).toBeNull();
    expect(segmentFromFilterValue(FILTERS.agent)).toBeNull();
  });

  it("does not read /dijualsewa as /dijual", () => {
    expect(segmentFromFilterValue(FILTERS.dijualsewaAnchored)).toBe("dijualsewa");
  });

  it("returns null for no filter at all", () => {
    expect(segmentFromFilterValue("")).toBeNull();
    expect(segmentFromFilterValue(undefined)).toBeNull();
  });
});

describe("detectGSCSegment", () => {
  it("falls back to the export's URLs when the filter names nothing", () => {
    expect(
      detectGSCSegment(FILTERS.agentProfile, [
        "/yayukpurnamasari",
        "/istiningsih",
        "/danieltantamaputro",
        "/persatuanrahmatkurnia",
      ]),
    ).toBe("agent_profile");

    expect(
      detectGSCSegment(FILTERS.agent, [
        "/agent/search",
        "/agent/serang",
        "/agent/surabaya",
        "/agent/solo",
      ]),
    ).toBe("agent");
  });

  it("prefers the filter when it names a segment", () => {
    expect(detectGSCSegment(FILTERS.detailPrimary, [])).toBe(
      "perumahan_baru_detail",
    );
  });

  it("returns null when neither the filter nor the URLs settle it", () => {
    expect(detectGSCSegment("", [])).toBeNull();
  });
});

describe("perumahan-baru blocks are disjoint", () => {
  const listing = SEGMENTS_BY_ID.perumahan_baru.match;
  const detail = SEGMENTS_BY_ID.perumahan_baru_detail.match;

  it("keeps viewdetail out of the listing block", () => {
    expect(listing("/perumahan-baru/rumah/lokal/batam")).toBe(true);
    expect(listing("/perumahan-baru/viewdetail/taman-jivva-kemlaten")).toBe(
      false,
    );
  });

  it("keeps listings out of the detail block", () => {
    expect(detail("/perumahan-baru/viewdetail/taman-jivva-kemlaten")).toBe(true);
    expect(detail("/perumahan-baru/rumah/lokal/batam")).toBe(false);
  });
});

/** A GSC export as both flows receive it: Chart + Pages + Filters tabs. */
function gscWorkbook({ pageFilter, urls }) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Date", "Clicks", "Impressions", "CTR", "Position"],
      ["2026-09-01", 10, 100, 0.1, 5],
      ["2026-09-30", 20, 300, 0.067, 7],
    ]),
    "Chart",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Top pages", "Clicks", "Impressions", "CTR", "Position"],
      ...urls.map((u, i) => [
        `https://www.brighton.co.id${u}`,
        10 + i,
        100 + i,
        0.1,
        5,
      ]),
    ]),
    "Pages",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Filter", "Value"],
      ["Search type", "Web"],
      ["Date", "1 Sept 2026-30 Sept 2026"],
      ...(pageFilter ? [["Page", pageFilter]] : []),
    ]),
    "Filters",
  );
  return wb;
}

const DIJUAL_URLS = [
  "/dijual/rumah/malang",
  "/dijual/rumah/surabaya",
  "/dijual/rumah/bali",
  "/dijual/rumah/medan",
];
const PROFILE_URLS = [
  "/yayukpurnamasari",
  "/istiningsih",
  "/danieltantamaputro",
  "/persatuanrahmatkurnia",
];

describe("Traffic (Optimized) GSC import", () => {
  it("imports a /dijual/ export whose filter is a regex", () => {
    const result = parseFlow1Workbook(
      gscWorkbook({ pageFilter: FILTERS.dijual, urls: DIJUAL_URLS }),
    );
    expect(result.type).toBe("gsc");
    expect(result.segment).toBe("bc_dijual");
    expect(getDataKey(result)).toBe("bc_gsc_dijual_2026-09");
  });

  it("names the segment of an export that belongs to Traffic Overview", () => {
    const result = parseFlow1Workbook(
      gscWorkbook({ pageFilter: FILTERS.agentProfile, urls: PROFILE_URLS }),
    );
    expect(result.segment).toBe("unknown");
    expect(result.detectedSegment).toBe("agent_profile");
    expect(getDataKey(result)).toBeNull();
  });
});

describe("Traffic Overview GSC import", () => {
  it("files an agent-profile export under its own segment", () => {
    const result = parseGSCChartWorkbook(
      gscWorkbook({ pageFilter: FILTERS.agentProfile, urls: PROFILE_URLS }),
    );
    expect(result.segment).toBe("agent_profile");
    expect(getFlow2DataKey(result)).toBe("gsc_agent_profile_2026-09");
  });

  it("does not collide a listing export with a detail export", () => {
    const listing = parseGSCChartWorkbook(
      gscWorkbook({
        pageFilter: FILTERS.perumahanBaru,
        urls: ["/perumahan-baru/rumah/lokal/batam"],
      }),
    );
    const detail = parseGSCChartWorkbook(
      gscWorkbook({
        pageFilter: FILTERS.detailPrimary,
        urls: ["/perumahan-baru/viewdetail/taman-jivva-kemlaten"],
      }),
    );
    expect(getFlow2DataKey(listing)).toBe("gsc_perumahan_baru_2026-09");
    expect(getFlow2DataKey(detail)).toBe(
      "gsc_perumahan_baru_detail_2026-09",
    );
    expect(getFlow2DataKey(listing)).not.toBe(getFlow2DataKey(detail));
  });

  it("treats an export with no Page filter as the grand total", () => {
    const result = parseGSCChartWorkbook(
      gscWorkbook({ pageFilter: null, urls: DIJUAL_URLS }),
    );
    expect(result.segment).toBe("all_organic");
  });

  it("gives no storage key to a filtered export it cannot place", () => {
    const result = parseGSCChartWorkbook(
      gscWorkbook({ pageFilter: "+/some-new-area/", urls: ["/some-new-area/x"] }),
    );
    expect(result.type).toBe("gsc_chart");
    expect(result.segment).toBeNull();
    expect(getFlow2DataKey(result)).toBeNull();
  });
});
