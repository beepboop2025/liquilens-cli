import type { Board, BoardRow } from "./api.js";

/**
 * India risk bands, grade letters and their colours are shown only while the
 * API says review tiers are published. A paused state, or an older payload
 * that does not say, renders research-only probabilities instead.
 */
export function tiersPublished(board: Pick<Board, "tier_publication"> | null | undefined): boolean {
  return board?.tier_publication?.state === "published";
}

/** One line stating the pause, in the API's own words when it sends them. */
export function pausedLine(board: Pick<Board, "tier_publication"> | null | undefined): string {
  const pub = board?.tier_publication;
  const since = pub?.since ? ` since ${pub.since}` : "";
  return `review tiers paused${since}: ${pub?.label ?? "tiers paused, research only"}; ` +
    "no grade, band or colour is shown and PDs are research only";
}

export type RiskBand = "red" | "amber" | "green";

/**
 * Maps a board row to the colour band used for the whole row in the terminal.
 *
 * This is a product/domain judgment, not a rendering detail: it decides what a
 * reader's eye is pulled to first. Inputs available on `row`:
 *   - hazard.pd_12m        12-month failure probability (0..1)
 *   - grade / hazard.grade letter grades
 *   - funding.band         "stable" | "watch" | "strain"
 *   - pca.risk_level       0..3, breaches list
 *   - forensics.fired      forensic indicators tripped
 */
export function riskBand(row: BoardRow): RiskBand {
  if (row.forensics.fired || row.pca.breaches.length > 0) return "red";
  if (row.hazard.pd_12m >= 0.05) return "red";
  const fundingStressed = !["stable", "not_scored"].includes(row.funding.band);
  if (row.hazard.pd_12m >= 0.015 || fundingStressed || row.pca.risk_level > 0)
    return "amber";
  return "green";
}

/**
 * US board banding is RELATIVE, not absolute: undertow scores are
 * within-quarter percentile ranks and the API already returns only the
 * riskiest tail (top 50 of ~1,000+), so fixed thresholds would drift across
 * quarters. Band by rank within the returned board instead: the reader's
 * question is "what's at the very top of the risky tail right now".
 */
export function usRiskBandByRank(rankInBoard: number): RiskBand {
  if (rankInBoard < 10) return "red";
  if (rankInBoard < 30) return "amber";
  return "green";
}

const BAND_ORDER: Record<RiskBand, number> = { green: 0, amber: 1, red: 2 };

/** True when `band` is at least as severe as `threshold` (for --fail-on). */
export function bandAtLeast(band: RiskBand, threshold: RiskBand): boolean {
  return BAND_ORDER[band] >= BAND_ORDER[threshold];
}

export const bandColor: Record<RiskBand, string> = {
  red: "#f26d6d",
  amber: "#e8b64f",
  green: "#66c28f",
};
