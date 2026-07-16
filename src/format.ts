import type { BoardRow, USRow } from "./api.js";

export const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/** Fraction -> "17.0%", tolerating missing values. */
export const pct1 = (x: number | null | undefined) =>
  x == null ? "—" : `${(x * 100).toFixed(1)}%`;

/** Value already in percent units (FDIC noncurrent_ratio: 4.0 = 4%). */
export const rawPct = (x: number | null | undefined) =>
  x == null ? "—" : `${x.toFixed(2)}%`;

/** Assets reported in USD thousands -> "$15.2B" / "$980M". */
export function fmtAssets(usdK: number): string {
  const usd = usdK * 1_000;
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(1)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  return `$${Math.round(usd / 1e6)}M`;
}

const SPARK_GLYPHS = "▁▂▃▄▅▆▇█";

/** Unicode sparkline of the last `width` values; flat series stays low. */
export function sparkline(values: number[], width: number): string {
  const vals = values.filter((v) => Number.isFinite(v)).slice(-width);
  if (vals.length < 2) return "";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min;
  return vals
    .map((v) => {
      const t = span === 0 ? 0 : (v - min) / span;
      return SPARK_GLYPHS[Math.min(7, Math.floor(t * 8))];
    })
    .join("");
}

export type MoveDir = "up" | "down" | "flat";

export function movement(delta: number): { text: string; dir: MoveDir } {
  if (delta > 0.0005) return { text: `▲ ${pct(delta)}`, dir: "up" };
  if (delta < -0.0005) return { text: `▼ ${pct(Math.abs(delta))}`, dir: "down" };
  return { text: "─", dir: "flat" };
}

export function fundingLabel(band: string): string {
  return band === "not_scored" ? "n/a" : band;
}

export interface Cols {
  name: number;
  type: number;
  grade: number;
  score: number;
  pd: number;
  move: number;
}

/**
 * Column widths for a given terminal width. The name column absorbs all
 * slack between a floor (narrow terminals truncate names) and a ceiling
 * (ultra-wide terminals shouldn't produce a mile of whitespace).
 */
export function computeCols(termWidth: number): Cols {
  const fixed = { type: 6, grade: 6, score: 6, pd: 8, move: 10 };
  const overhead =
    2 /* pointer */ +
    2 /* outer padding */ +
    11; /* funding col, unpadded but reserve room for "not_scored" */
  const used =
    fixed.type + fixed.grade + fixed.score + fixed.pd + fixed.move + overhead;
  const name = Math.max(18, Math.min(40, termWidth - used));
  return { name, ...fixed };
}

/** Truncate to width (with ellipsis) then pad — cells never overflow. */
export function cell(text: string, width: number): string {
  if (text.length > width - 1) {
    return `${text.slice(0, Math.max(0, width - 2))}… `.padEnd(width);
  }
  return text.padEnd(width);
}

export type SortMode = "risk" | "movement" | "score" | "name";

export const SORT_MODES: SortMode[] = ["risk", "movement", "score", "name"];

export function sortRows(rows: BoardRow[], mode: SortMode): BoardRow[] {
  const sorted = [...rows];
  switch (mode) {
    case "risk":
      sorted.sort((a, b) => b.hazard.pd_12m - a.hazard.pd_12m);
      break;
    case "movement":
      sorted.sort((a, b) => b.movement.delta_pd_12m - a.movement.delta_pd_12m);
      break;
    case "score":
      sorted.sort((a, b) => a.score - b.score);
      break;
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

export function filterRows(rows: BoardRow[], query: string): BoardRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.slug.includes(q) ||
      r.inst_type.toLowerCase().includes(q),
  );
}

export type USSortMode = "risk" | "noncurrent" | "uninsured" | "assets" | "name";

export const US_SORT_MODES: USSortMode[] = [
  "risk",
  "noncurrent",
  "uninsured",
  "assets",
  "name",
];

export function sortUSRows(rows: USRow[], mode: USSortMode): USRow[] {
  const sorted = [...rows];
  const num = (x: number | null | undefined) => x ?? -Infinity;
  switch (mode) {
    case "risk":
      sorted.sort((a, b) => b.undertow_score_v02 - a.undertow_score_v02);
      break;
    case "noncurrent":
      sorted.sort((a, b) => num(b.noncurrent_ratio) - num(a.noncurrent_ratio));
      break;
    case "uninsured":
      sorted.sort((a, b) => num(b.uninsured_ratio) - num(a.uninsured_ratio));
      break;
    case "assets":
      sorted.sort((a, b) => b.assets_usd_k - a.assets_usd_k);
      break;
    case "name":
      sorted.sort((a, b) => a.bank.localeCompare(b.bank));
      break;
  }
  return sorted;
}

export function filterUSRows(rows: USRow[], query: string): USRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.bank.toLowerCase().includes(q) ||
      r.state.toLowerCase().includes(q) ||
      String(r.cert) === q,
  );
}

export interface USCols {
  bank: number;
  state: number;
  assets: number;
  score: number;
  noncurr: number;
  uninsured: number;
  ndfi: number;
}

export function computeUSCols(termWidth: number): USCols {
  const fixed = { state: 15, assets: 8, score: 7, noncurr: 9, uninsured: 10, ndfi: 6 };
  const overhead = 2 /* pointer */ + 2; /* outer padding */
  const used =
    fixed.state +
    fixed.assets +
    fixed.score +
    fixed.noncurr +
    fixed.uninsured +
    fixed.ndfi +
    overhead;
  const bank = Math.max(16, Math.min(36, termWidth - used));
  return { bank, ...fixed };
}

/**
 * Visible slice of the table for a viewport of `visible` rows, keeping the
 * cursor in view. Returns the slice bounds and how many rows are hidden
 * above/below.
 */
export function viewport(
  total: number,
  visible: number,
  cursor: number,
): { start: number; end: number; above: number; below: number } {
  if (total <= visible || visible <= 0) {
    return { start: 0, end: total, above: 0, below: 0 };
  }
  let start = cursor - Math.floor(visible / 2);
  start = Math.max(0, Math.min(start, total - visible));
  const end = start + visible;
  return { start, end, above: start, below: total - end };
}
