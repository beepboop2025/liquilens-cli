import { test } from "node:test";
import assert from "node:assert/strict";
import { riskBand } from "./riskBands.js";
import type { BoardRow } from "./api.js";

function row(over: Record<string, unknown> = {}): BoardRow {
  return {
    slug: "x",
    name: "X",
    inst_type: "mfi",
    label: "x",
    as_of: "2026-06-30",
    quarter: "FY27Q1",
    age_months: 1,
    score: 90,
    grade: "AAA",
    hazard: { pd_12m: 0.001, pd_24m: 0, pd_36m: 0, grade: "A", drivers: {}, basis: [] },
    movement: { delta_pd_12m: 0 },
    pca: { applicable: false, status: "not_applicable", risk_level: 0, breaches: [] },
    funding: { index: 0, band: "stable", flags: [], basis: [] },
    forensics: { eligible: true, fired: false, indicators: [] },
    market: null,
    ...over,
  } as BoardRow;
}

test("healthy row is green", () => {
  assert.equal(riskBand(row()), "green");
});

test("forensics fired or PCA breach is red regardless of PD", () => {
  assert.equal(riskBand(row({ forensics: { eligible: true, fired: true, indicators: ["a"] } })), "red");
  assert.equal(
    riskBand(row({ pca: { applicable: true, status: "risk", risk_level: 1, breaches: ["CRAR"] } })),
    "red",
  );
});

test("PD thresholds: >=5% red, >=1.5% amber", () => {
  assert.equal(riskBand(row({ hazard: { pd_12m: 0.05, pd_24m: 0, pd_36m: 0, grade: "C", drivers: {}, basis: [] } })), "red");
  assert.equal(riskBand(row({ hazard: { pd_12m: 0.02, pd_24m: 0, pd_36m: 0, grade: "B", drivers: {}, basis: [] } })), "amber");
});

test("not_scored funding is NOT stress — stays green", () => {
  assert.equal(riskBand(row({ funding: { index: 0, band: "not_scored", flags: [], basis: [] } })), "green");
});

test("stressed funding band is amber", () => {
  assert.equal(riskBand(row({ funding: { index: 0.5, band: "watch", flags: [], basis: [] } })), "amber");
});
