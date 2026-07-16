import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeUSCols,
  filterUSRows,
  fmtAssets,
  pct1,
  rawPct,
  sortUSRows,
  sparkline,
} from "./format.js";
import { usRiskBandByRank, bandAtLeast } from "./riskBands.js";
import type { USRow } from "./api.js";

let certSeq = 1000;
function usRow(over: Partial<USRow> & { bank: string }): USRow {
  return {
    cert: certSeq++,
    state: "Texas",
    assets_usd_k: 2_000_000,
    undertow_score_v02: 0.75,
    signals_available: 11,
    uninsured_ratio: 0.2,
    brokered_ratio: 0.1,
    noncurrent_ratio: 1.5,
    cre_concentration: 0.3,
    ndfi_to_tier1: 0.5,
    ...over,
  };
}

test("fmtAssets scales thousands-USD to M/B/T", () => {
  assert.equal(fmtAssets(15_229_819), "$15.2B");
  assert.equal(fmtAssets(980_000), "$980M");
  assert.equal(fmtAssets(1_200_000_000), "$1.2T");
});

test("pct1 treats input as fraction; rawPct as already-percent", () => {
  assert.equal(pct1(0.1701), "17.0%");
  assert.equal(rawPct(4.0004), "4.00%");
  assert.equal(pct1(null), "—");
  assert.equal(rawPct(undefined), "—");
});

test("usRiskBandByRank: top 10 red, next 20 amber, rest green", () => {
  assert.equal(usRiskBandByRank(0), "red");
  assert.equal(usRiskBandByRank(9), "red");
  assert.equal(usRiskBandByRank(10), "amber");
  assert.equal(usRiskBandByRank(29), "amber");
  assert.equal(usRiskBandByRank(30), "green");
});

test("bandAtLeast orders green < amber < red", () => {
  assert.ok(bandAtLeast("red", "amber"));
  assert.ok(bandAtLeast("amber", "amber"));
  assert.ok(!bandAtLeast("green", "amber"));
  assert.ok(!bandAtLeast("amber", "red"));
});

test("sortUSRows handles null metrics and does not mutate", () => {
  const rows = [
    usRow({ bank: "A", noncurrent_ratio: null }),
    usRow({ bank: "B", noncurrent_ratio: 2 }),
  ];
  const sorted = sortUSRows(rows, "noncurrent");
  assert.equal(sorted[0]!.bank, "B");
  assert.equal(rows[0]!.bank, "A");
});

test("filterUSRows matches bank, state, and exact cert", () => {
  const rows = [
    usRow({ bank: "Live Oak Banking Company", state: "North Carolina", cert: 58665 }),
    usRow({ bank: "Axiom Bank", state: "Florida", cert: 12345 }),
  ];
  assert.equal(filterUSRows(rows, "live oak").length, 1);
  assert.equal(filterUSRows(rows, "florida").length, 1);
  assert.equal(filterUSRows(rows, "58665").length, 1);
  assert.equal(filterUSRows(rows, "9").length, 0);
});

test("computeUSCols keeps bank column bounded at any width", () => {
  for (const w of [40, 80, 100, 160, 400]) {
    const cols = computeUSCols(w);
    assert.ok(cols.bank >= 16 && cols.bank <= 36, `width ${w} -> ${cols.bank}`);
  }
});

test("sparkline maps min/max to lowest/highest glyphs", () => {
  const s = sparkline([0, 1, 2, 3], 10);
  assert.equal(s.length, 4);
  assert.equal(s[0], "▁");
  assert.equal(s[3], "█");
  assert.equal(sparkline([5, 5, 5], 10), "▁▁▁");
  assert.equal(sparkline([1], 10), "");
  assert.equal(sparkline([1, NaN, 2], 10).length, 2);
  assert.equal(sparkline(Array.from({ length: 250 }, (_, i) => i), 28).length, 28);
});
