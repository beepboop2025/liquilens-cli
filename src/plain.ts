import type {
  Board,
  EvidenceMarketsResponse,
  HistoricalEvidenceStatus,
  MarketRegime,
  USBoard,
} from "./api.js";
import {
  cell,
  computeCols,
  computeUSCols,
  fmtAssets,
  fundingLabel,
  movement,
  pct,
  pct1,
  rawPct,
  sortRows,
  sortUSRows,
} from "./format.js";
import { riskBand, usRiskBandByRank, type RiskBand } from "./riskBands.js";

export interface StaleInfo {
  savedAt: string;
  description: string;
}

export type Snapshot =
  | { region: "in"; board: Board; regime: MarketRegime | null; stale: StaleInfo | null }
  | { region: "us"; board: USBoard; stale: StaleInfo | null };

function staleLine(stale: StaleInfo | null): string[] {
  return stale
    ? [`WARNING: live API unreachable — cached data from ${stale.description}`]
    : [];
}

/** Worst risk band on the board — drives --fail-on exit codes. */
export function worstBand(snap: Snapshot): RiskBand {
  if (snap.region === "us") {
    // US board is a relative leaderboard; callers must not use it for
    // absolute alerting (enforced at arg-parse time).
    return snap.board.board.length > 0 ? "red" : "green";
  }
  let worst: RiskBand = "green";
  for (const row of snap.board.rows) {
    const b = riskBand(row);
    if (b === "red") return "red";
    if (b === "amber") worst = "amber";
  }
  return worst;
}

/** ANSI-free table for pipes, scripts, CI logs, and `--plain`. */
export function renderPlain(snap: Snapshot, width = 100): string {
  if (snap.region === "us") return renderPlainUS(snap, width);
  const cols = computeCols(width);
  const lines: string[] = [];
  lines.push(
    `LIQUILENS Failure Radar · INDIA · board as of ${snap.board.as_of}`,
  );
  if (snap.regime) {
    lines.push(
      `market regime ${snap.regime.regime} (log-SR ${snap.regime.log_sr_now.toFixed(2)}, ` +
        `last change ${snap.regime.trading_days_since_last_change}d ago) · ${snap.regime.as_of}`,
    );
  }
  lines.push(...staleLine(snap.stale));
  lines.push("");
  lines.push(
    "  " +
      cell("INSTITUTION", cols.name) +
      cell("TYPE", cols.type) +
      cell("GRADE", cols.grade) +
      cell("SCORE", cols.score) +
      cell("PD 12M", cols.pd) +
      cell("Δ PD", cols.move) +
      "FUNDING  BAND",
  );
  for (const row of sortRows(snap.board.rows, "risk")) {
    const band = riskBand(row);
    lines.push(
      "  " +
        cell(row.name, cols.name) +
        cell(row.inst_type, cols.type) +
        cell(row.grade, cols.grade) +
        cell(String(row.score), cols.score) +
        cell(pct(row.hazard.pd_12m), cols.pd) +
        cell(movement(row.movement.delta_pd_12m).text, cols.move) +
        cell(fundingLabel(row.funding.band), 9) +
        band.toUpperCase(),
    );
  }
  lines.push("");
  lines.push(`${snap.board.rows.length} institutions · liquilens.in`);
  return lines.join("\n");
}

function renderPlainUS(
  snap: Extract<Snapshot, { region: "us" }>,
  width: number,
): string {
  const cols = computeUSCols(width);
  const { board } = snap;
  const lines: string[] = [];
  lines.push(
    `LIQUILENS Failure Radar · US · quarter as of ${board.as_of} · ` +
      `top ${board.board.length} of ${board.universe.banks_scored} banks scored`,
  );
  lines.push(`source: ${board.provenance.source} · ${board.provenance.engine}`);
  lines.push(...staleLine(snap.stale));
  lines.push("");
  lines.push(
    "  " +
      cell("BANK", cols.bank) +
      cell("STATE", cols.state) +
      cell("ASSETS", cols.assets) +
      cell("SCORE", cols.score) +
      cell("NONCURR", cols.noncurr) +
      cell("UNINSURED", cols.uninsured) +
      "NDFI/T1",
  );
  const rows = sortUSRows(board.board, "risk");
  rows.forEach((r, i) => {
    lines.push(
      "  " +
        cell(r.bank, cols.bank) +
        cell(r.state, cols.state) +
        cell(fmtAssets(r.assets_usd_k), cols.assets) +
        cell(r.undertow_score_v02.toFixed(3), cols.score) +
        cell(rawPct(r.noncurrent_ratio), cols.noncurr) +
        cell(pct1(r.uninsured_ratio), cols.uninsured) +
        cell(pct1(r.ndfi_to_tier1), 8) +
        usRiskBandByRank(i).toUpperCase(),
    );
  });
  lines.push("");
  lines.push(
    "score = within-quarter percentile rank (relative leaderboard, not a PD) · liquilens.in",
  );
  return lines.join("\n");
}

/** Machine-readable dump for `--json`. */
export function renderJson(snap: Snapshot): string {
  if (snap.region === "us") {
    const rows = sortUSRows(snap.board.board, "risk");
    return JSON.stringify(
      {
        region: "us",
        as_of: snap.board.as_of,
        stale: snap.stale ? { cached_at: snap.stale.savedAt } : null,
        universe: snap.board.universe,
        provenance: snap.board.provenance,
        rows: rows.map((r, i) => ({ ...r, risk_band: usRiskBandByRank(i) })),
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      region: "in",
      as_of: snap.board.as_of,
      stale: snap.stale ? { cached_at: snap.stale.savedAt } : null,
      market_regime: snap.regime,
      rows: sortRows(snap.board.rows, "risk").map((r) => ({
        ...r,
        risk_band: riskBand(r),
      })),
    },
    null,
    2,
  );
}

function evidenceFlag(value: boolean | undefined): string {
  if (value === true) return "YES";
  if (value === false) return "NO";
  return "NOT STATED";
}

/** One-shot evidence boundary for humans; no eligibility is inferred. */
export function renderEvidenceRecord(record: EvidenceMarketsResponse): string {
  const lines = [
    "LIQUILENS · HISTORICAL EVIDENCE STATUS",
    "Eligibility is served per market; construction-PIT diagnostics are not promoted by the CLI.",
    "",
  ];
  for (const market of record.markets) {
    const evidence = market.historical_evidence ?? ({} as HistoricalEvidenceStatus);
    lines.push(market.name.toUpperCase());
    lines.push(`  kind: ${market.kind}`);
    lines.push(`  ${market.headline}`);
    lines.push(`  status: ${evidence.status ?? "NOT_STATED"}`);
    lines.push(
      "  validated-backtest eligible: " +
        evidenceFlag(evidence.validated_backtest_eligible) +
        " · real-money eligible: " +
        evidenceFlag(evidence.real_money_eligible),
    );
    lines.push("");
  }
  lines.push("source: https://api.liquilens.in/api/evidence/markets");
  return lines.join("\n");
}

/** Preserve the API payload exactly for agents and scripts. */
export function renderEvidenceJson(record: EvidenceMarketsResponse): string {
  return JSON.stringify(record, null, 2);
}
