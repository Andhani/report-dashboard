import { describe, it, expect } from "vitest";
import { computeBCLeads, computeBlogLeads, getLeadsMonth } from "../computeFlow3";
import { slots, blogUrls, bcUrls, flow1Data, flow2Data } from "./fixtures";

const sep = slots[1];
const FULL = { startDay: null, endDay: null };
const PARTIAL = { startDay: 5, endDay: 20 };

// Site-wide Sep figures from the fixture, used to derive the expected rates
// by hand rather than copying whatever the code returns.
const CLICK_CONTACT = 1250;
const TOTAL_VIEWS = 50000;
const TOTAL_USERS = 38000;
const TOTAL_SESSIONS = 44000;

describe("getLeadsMonth", () => {
  it("defaults to the last slot in the window", () => {
    expect(getLeadsMonth(slots)).toBe(slots[1]);
  });
});

describe("computeBCLeads", () => {
  it("splits published in-range rows into Creates and Updates", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, FULL);
    expect(b.creates.count).toBe(1); // rumah-bsd
    expect(b.updates.count).toBe(1); // apt-scbd
    expect(b.grandTotal.count).toBe(2); // ruko is a Draft
    expect(b.monthLabel).toBe("September 2026");
  });

  it("sums GA4 per group, across both BC segment keys", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, FULL);
    // rumah-bsd lives under bc_ga4_dijual, apt-scbd under bc_ga4_disewa.
    expect(b.creates.traffic.views).toBe(400);
    expect(b.creates.traffic.aet_seconds).toBeCloseTo(88.0, 10);
    expect(b.updates.traffic.views).toBe(180);
    expect(b.updates.traffic.aet_seconds).toBeCloseTo(62.5, 10);
  });

  // The split must partition the rows the block always counted, never change
  // the arithmetic. These are the figures the single-block version returned
  // for this fixture, asserted against the two groups combined.
  it("leaves the underlying totals identical to the unsplit block", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, FULL);
    expect(b.grandTotal.traffic.views).toBe(580);
    expect(b.grandTotal.traffic.users).toBe(460);
    expect(b.grandTotal.traffic.sessions).toBe(550);
    expect(b.grandTotal.traffic.aet_seconds).toBeCloseTo(75.25, 10);
    // And the groups add up to it.
    expect(b.creates.traffic.views + b.updates.traffic.views).toBe(580);
    expect(b.creates.traffic.users + b.updates.traffic.users).toBe(460);
    expect(b.creates.traffic.sessions + b.updates.traffic.sessions).toBe(550);
  });

  it("derives lead rates from the site-wide Flow 2 totals", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, FULL);
    expect(b.rates.leadPerViews).toBeCloseTo(CLICK_CONTACT / TOTAL_VIEWS, 12);
    expect(b.rates.leadPerUsers).toBeCloseTo(CLICK_CONTACT / TOTAL_USERS, 12);
    expect(b.rates.leadPerSessions).toBeCloseTo(
      CLICK_CONTACT / TOTAL_SESSIONS,
      12,
    );
  });

  it("estimates leads as traffic x rate, per group", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, FULL);
    expect(b.creates.estimated.views).toBeCloseTo(
      400 * (CLICK_CONTACT / TOTAL_VIEWS),
      10,
    );
    expect(b.updates.estimated.views).toBeCloseTo(
      180 * (CLICK_CONTACT / TOTAL_VIEWS),
      10,
    );
    expect(b.updates.estimated.users).toBeCloseTo(
      140 * (CLICK_CONTACT / TOTAL_USERS),
      10,
    );
    // Estimates over both groups still match the unsplit figure.
    expect(b.creates.estimated.views + b.updates.estimated.views).toBeCloseTo(
      580 * (CLICK_CONTACT / TOTAL_VIEWS),
      10,
    );
  });

  it("honours a partial day range", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, PARTIAL);
    // Only apt-scbd (18 Sep, an Update); rumah-bsd is the 2nd, outside 5-20.
    expect(b.creates.count).toBe(0);
    expect(b.updates.count).toBe(1);
    expect(b.updates.traffic.views).toBe(180);
  });

  it("counts only an exact Create or Update", () => {
    const blank = bcUrls.map((r) => ({ ...r, content_type: "" }));
    const b = computeBCLeads(blank, flow1Data, flow2Data, sep, FULL);
    expect(b.grandTotal.count).toBe(0);
    expect(b.grandTotal.traffic.views).toBe(0);
  });
});

describe("computeBlogLeads", () => {
  it("splits published in-range rows into Creates and Updates", () => {
    const b = computeBlogLeads(blogUrls, flow1Data, flow2Data, sep, FULL);
    expect(b.creates.count).toBe(2); // harga-rumah + tips-kpr
    expect(b.updates.count).toBe(1); // investasi
  });

  it("sums each group's GA4 over its own slugs", () => {
    const b = computeBlogLeads(blogUrls, flow1Data, flow2Data, sep, FULL);
    expect(b.creates.traffic.views).toBe(900 + 640);
    expect(b.creates.traffic.users).toBe(700 + 500);
    expect(b.creates.traffic.sessions).toBe(820 + 590);
    expect(b.creates.traffic.aet_seconds).toBeCloseTo((95.4 + 130.2) / 2, 10);

    expect(b.updates.traffic.views).toBe(310);
    expect(b.updates.traffic.aet_seconds).toBeCloseTo(70.8, 10);
  });

  it("excludes drafts and rows from other months", () => {
    const b = computeBlogLeads(blogUrls, flow1Data, flow2Data, sep, FULL);
    // sewa-apt is a Draft, lama is August — neither may contribute.
    const all = b.creates.traffic.views + b.updates.traffic.views;
    expect(all).toBe(900 + 640 + 310);
  });

  it("honours a partial day range", () => {
    const b = computeBlogLeads(blogUrls, flow1Data, flow2Data, sep, PARTIAL);
    expect(b.creates.count).toBe(1); // tips-kpr (11 Sep); harga-rumah is the 3rd
    expect(b.updates.count).toBe(1); // investasi (20 Sep, inclusive)
    expect(b.creates.traffic.views).toBe(640);
  });

  it("includes the 20th — the range end is inclusive", () => {
    const b = computeBlogLeads(blogUrls, flow1Data, flow2Data, sep, { startDay: 20, endDay: 20 });
    expect(b.updates.count).toBe(1);
  });

  // Content Type is matched exactly. Import copies whatever the sheet cell
  // says, so a near-miss ("update", "Create ") is not a third category — it
  // is a row that drops out of the report silently. Create and Update are
  // the only two values the Blog list uses.
  it("counts only an exact Create or Update, never a near-miss", () => {
    const b = computeBlogLeads(blogUrls, flow1Data, flow2Data, sep, FULL);
    const nearMiss = blogUrls.find((r) => r.content_type === "update");
    expect(nearMiss.status).toBe("Published"); // in range, so only the case differs
    expect(b.grandTotal.count).toBe(3); // not 4
    expect(b.grandTotal.traffic.views).toBe(900 + 640 + 310); // its 150 views excluded
  });
});
