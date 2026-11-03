import { test } from "node:test";
import assert from "node:assert/strict";
import type { Board, BoardRow, TierPublication } from "./api.js";
import { renderJson, renderPlain, worstBand, type Snapshot } from "./plain.js";

const paused: TierPublication = {
  state: "paused",
  since: "2026-11-03",
  label: "tiers paused, research only",
  reason: "the refit hazard model has not re-validated",
  revalidation_condition: "the hazard model re-validates out of time",
};

function row(slug: string, pd: number, grade?: string): BoardRow {
  return {
    slug, name: `${slug} Bank`, inst_type: "sfb", label: "healthy_control",
    as_of: "2026-09-30", quarter: "FY27Q2", age_months: 1, score: 81,
    ...(grade ? { grade } : {}),
    hazard: { pd_12m: pd, pd_24m: pd * 2, pd_36m: pd * 3, drivers: {}, basis: [],
      ...(grade ? { grade } : {}) },
    movement: { delta_pd_12m: 0 },
    pca: { applicable: true, status: "none", risk_level: 0, breaches: [] },
    funding: { index: 10, band: "stable", flags: [], basis: [] },
    forensics: { eligible: false, fired: false, indicators: [] },
    market: null,
  };
}

function snap(board: Board): Snapshot {
  return { region: "in", board, regime: null, stale: null };
}

// A cached pre-pause row may still carry a grade; it must not leak either.
const pausedBoard: Board = {
  as_of: "2026-11-03", tier_publication: paused,
  rows: [row("alpha", 0.0026), row("beta", 0.0021, "AA")],
};
const publishedBoard: Board = {
  as_of: "2026-11-03", tier_publication: { ...paused, state: "published" },
  rows: [row("alpha", 0.0026, "A"), row("beta", 0.0021, "AA")],
};

test("paused plain table shows no grade, band or band word", () => {
  const text = renderPlain(snap(pausedBoard));
  assert.match(text, /review tiers paused since 2026-11-03: tiers paused, research only/);
  assert.doesNotMatch(text, /GRADE|BAND|\bGREEN\b|\bAMBER\b|\bRED\b|\bAA\b/);
  assert.match(text, /research only while review tiers are paused/);
});

test("paused JSON carries the state and no grade or risk band", () => {
  const out = JSON.parse(renderJson(snap(pausedBoard)));
  assert.equal(out.tier_publication.state, "paused");
  for (const r of out.rows) {
    assert.equal(r.risk_band, undefined);
    assert.equal(r.grade, undefined);
    assert.equal(r.hazard.grade, undefined);
    assert.equal(r.pd_research_only, true);
  }
});

test("--fail-on has no band to compare while paused, never a silent pass", () => {
  assert.equal(worstBand(snap(pausedBoard)), null);
  // An older payload that does not state the publication fails closed too.
  assert.equal(worstBand(snap({ as_of: "2026-11-03", rows: publishedBoard.rows })), null);
});

test("positive control: a published board still renders grades and bands", () => {
  const text = renderPlain(snap(publishedBoard));
  assert.match(text, /GRADE/);
  assert.match(text, /BAND/);
  const out = JSON.parse(renderJson(snap(publishedBoard)));
  assert.ok(out.rows.every((r: { risk_band?: string }) => typeof r.risk_band === "string"));
  assert.notEqual(worstBand(snap(publishedBoard)), null);
});
