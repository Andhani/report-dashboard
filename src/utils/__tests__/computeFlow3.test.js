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
  it("counts only published rows in the month", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, FULL);
    // rumah-bsd (Published) + apt-scbd (Published Create); ruko is Draft.
    expect(b.count).toBe(2);
    expect(b.monthLabel).toBe("September 2026");
  });

  it("sums GA4 across both BC segments, averaging AET over non-zero rows", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, FULL);
    expect(b.traffic.views).toBe(400 + 180);
    expect(b.traffic.users).toBe(320 + 140);
    expect(b.traffic.sessions).toBe(380 + 170);
    expect(b.traffic.aet_seconds).toBeCloseTo((88.0 + 62.5) / 2, 10);
  });

  it("derives lead rates from the site-wide Flow 2 totals", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, FULL);
    expect(b.rates.leadPerViews).toBeCloseTo(CLICK_CONTACT / TOTAL_VIEWS, 12);
    expect(b.rates.leadPerUsers).toBeCloseTo(CLICK_CONTACT / TOTAL_USERS, 12);
    expect(b.rates.leadPerSessions).toBeCloseTo(CLICK_CONTACT / TOTAL_SESSIONS, 12);
  });

  it("estimates leads as traffic x rate", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, FULL);
    expect(b.estimated.views).toBeCloseTo(580 * (CLICK_CONTACT / TOTAL_VIEWS), 10);
    expect(b.estimated.users).toBeCloseTo(460 * (CLICK_CONTACT / TOTAL_USERS), 10);
    expect(b.estimated.sessions).toBeCloseTo(550 * (CLICK_CONTACT / TOTAL_SESSIONS), 10);
  });

  it("honours a partial day range", () => {
    const b = computeBCLeads(bcUrls, flow1Data, flow2Data, sep, PARTIAL);
    // Only apt-scbd (18 Sep); rumah-bsd is the 2nd, outside days 5-20.
    expect(b.count).toBe(1);
    expect(b.traffic.views).toBe(180);
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

  // Documents current behaviour, which is a known gap rather than a desired
  // rule: "Optimize" is offered in the URL List dropdown but is bucketed as
  // neither a Create nor an Update, so its traffic is absent from the block.
  it("drops Optimize rows from every bucket (known gap)", () => {
    const b = computeBlogLeads(blogUrls, flow1Data, flow2Data, sep, FULL);
    const optimize = blogUrls.find((r) => r.content_type === "Optimize");
    expect(optimize.status).toBe("Published"); // in range, would otherwise count
    expect(b.grandTotal.count).toBe(3); // not 4
    expect(b.grandTotal.traffic.views).toBe(900 + 640 + 310); // rumah-bekas' 150 missing
  });
});
