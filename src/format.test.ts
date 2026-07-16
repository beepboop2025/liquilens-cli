import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cell,
  computeCols,
  filterRows,
  fundingLabel,
  movement,
  pct,
  sortRows,
  viewport,
} from "./format.js";
import type { BoardRow } from "./api.js";

function row(over: Partial<BoardRow> & { name: string }): BoardRow {
  return {
    slug: over.name.toLowerCase().replace(/\s+/g, "-"),
    inst_type: "mfi",
    label: "x",
    as_of: "2026-06-30",
    quarter: "FY27Q1",
    age_months: 1,
    score: 90,
    grade: "AAA",
    hazard: { pd_12m: 0.001, pd_24m: 0.002, pd_36m: 0.003, grade: "A", drivers: {}, basis: [] },
    movement: { delta_pd_12m: 0 },
    pca: { applicable: false, status: "not_applicable", risk_level: 0, breaches: [] },
    funding: { index: 0, band: "stable", flags: [], basis: [] },
    forensics: { eligible: true, fired: false, indicators: [] },
    market: null,
    ...over,
  } as BoardRow;
}

test("pct formats probabilities as percentages", () => {
  assert.equal(pct(0.004), "0.40%");
  assert.equal(pct(0), "0.00%");
  assert.equal(pct(1), "100.00%");
});

test("movement classifies direction with a dead zone", () => {
  assert.equal(movement(0.001).dir, "up");
  assert.equal(movement(-0.001).dir, "down");
  assert.equal(movement(0.0001).dir, "flat");
  assert.equal(movement(0).text, "─");
});

test("fundingLabel renders not_scored as n/a", () => {
  assert.equal(fundingLabel("not_scored"), "n/a");
  assert.equal(fundingLabel("stable"), "stable");
});

test("cell truncates with ellipsis and pads to exact width", () => {
  assert.equal(cell("abc", 6), "abc   ");
  assert.equal(cell("abcdefgh", 6).length, 6);
  assert.ok(cell("abcdefgh", 6).includes("…"));
});

test("computeCols keeps name column within bounds at any width", () => {
  for (const w of [20, 40, 60, 80, 100, 200, 500]) {
    const cols = computeCols(w);
    assert.ok(cols.name >= 18 && cols.name <= 40, `width ${w} -> ${cols.name}`);
  }
});

test("computeCols total row width fits an 80-col terminal", () => {
  const c = computeCols(80);
  const rowWidth =
    2 + c.name + c.type + c.grade + c.score + c.pd + c.move + "not_scored".length;
  assert.ok(rowWidth + 2 <= 80, `row would be ${rowWidth + 2} wide`);
});

test("sortRows: risk = pd desc, score = asc, name = alpha", () => {
  const rows = [
    row({ name: "B", score: 90, hazard: { pd_12m: 0.001, pd_24m: 0, pd_36m: 0, grade: "A", drivers: {}, basis: [] } }),
    row({ name: "A", score: 60, hazard: { pd_12m: 0.005, pd_24m: 0, pd_36m: 0, grade: "A", drivers: {}, basis: [] } }),
  ];
  assert.equal(sortRows(rows, "risk")[0]!.name, "A");
  assert.equal(sortRows(rows, "score")[0]!.name, "A");
  assert.equal(sortRows(rows, "name")[0]!.name, "A");
  assert.equal(rows[0]!.name, "B", "sortRows must not mutate input");
});

test("filterRows matches name, slug, and type case-insensitively", () => {
  const rows = [row({ name: "ESAF Small Finance Bank", inst_type: "sfb" }), row({ name: "UGRO Capital", inst_type: "nbfc" })];
  assert.equal(filterRows(rows, "esaf").length, 1);
  assert.equal(filterRows(rows, "nbfc").length, 1);
  assert.equal(filterRows(rows, "").length, 2);
  assert.equal(filterRows(rows, "zzz").length, 0);
});

test("viewport keeps cursor visible and reports hidden counts", () => {
  assert.deepEqual(viewport(10, 20, 0), { start: 0, end: 10, above: 0, below: 0 });
  const atTop = viewport(19, 5, 0);
  assert.equal(atTop.start, 0);
  const atEnd = viewport(19, 5, 18);
  assert.equal(atEnd.end, 19);
  for (let c = 0; c < 19; c++) {
    const vp = viewport(19, 5, c);
    assert.ok(c >= vp.start && c < vp.end, `cursor ${c} outside [${vp.start},${vp.end})`);
    assert.equal(vp.end - vp.start, 5);
  }
});
