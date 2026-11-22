import { hasRadarDetail, probabilities, probabilityChange } from "./api.js";
import type {
  Board,
  IndiaRow,
  EvidenceMarketsResponse,
  HistoricalEvidenceStatus,
  LensAnswer,
  MarketRegime,
  USBoard,
} from "./api.js";
import {
  cell,
  computeCols,
  computeUSCols,
  fmtAssets,
  fundingSummary,
  movement,
  pct,
  pct1,
  rawPct,
  sortRows,
  sortUSRows,
} from "./format.js";
import { pausedLine, riskBand, tiersPublished, usRiskBandByRank, type RiskBand } from "./riskBands.js";

export interface StaleInfo {
  savedAt: string;
  description: string;
}

export type Snapshot =
  | { region: "in"; board: Board; regime: MarketRegime | null; stale: StaleInfo | null }
  | { region: "us"; board: USBoard; stale: StaleInfo | null };

function staleLine(stale: StaleInfo | null): string[] {
  return stale
    ? [`WARNING: live API unreachable; cached data from ${stale.description}`]
    : [];
}

/** Worst risk band on the board, which drives --fail-on exit codes. Null for
 *  India while review tiers are paused: there is no band to compare. */
export function worstBand(snap: Snapshot): RiskBand | null {
  if (snap.region === "us") {
    // US board is a relative leaderboard; callers must not use it for
    // absolute alerting (enforced at arg-parse time).
    return snap.board.board.length > 0 ? "red" : "green";
  }
  if (!tiersPublished(snap.board) || !snap.board.rows.length || !snap.board.rows.every(hasRadarDetail)) {
    return null;
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
  if (snap.regime?.available) {
    lines.push(
      `market regime ${snap.regime.regime} (log-SR ${snap.regime.log_sr_now.toFixed(2)}, ` +
        `last change ${snap.regime.trading_days_since_last_change}d ago) · ${snap.regime.as_of}`,
    );
  }
  lines.push(...staleLine(snap.stale));
  const published = tiersPublished(snap.board);
  if (!published) lines.push(pausedLine(snap.board));
  if (snap.board.rows.some((row) => !hasRadarDetail(row))) {
    lines.push("Rows in the public summary show a funding index. Detailed risk inputs are withheld.");
  }
  lines.push("");
  lines.push(
    "  " +
      cell("INSTITUTION", cols.name) +
      cell("TYPE", cols.type) +
      (published ? cell("GRADE", cols.grade) : "") +
      cell("SCORE", cols.score) +
      cell(published ? "PD 12M" : "PD 12M*", cols.pd) +
      cell("Δ PD", cols.move) +
      (published ? "FUNDING  BAND" : "FUNDING"),
  );
  for (const row of sortRows(snap.board.rows, "risk")) {
    lines.push(
      "  " +
        cell(row.name, cols.name) +
        cell(row.inst_type, cols.type) +
        (published ? cell(row.grade ?? "", cols.grade) : "") +
        cell(String(row.score), cols.score) +
        cell(pct(probabilities(row).pd_12m), cols.pd) +
        cell(movement(probabilityChange(row)).text, cols.move) +
        (published
          ? fundingSummary(row).padEnd(12) + (hasRadarDetail(row) ? riskBand(row).toUpperCase() : "n/a")
          : fundingSummary(row)),
    );
  }
  if (!published) lines.push("* research only while review tiers are paused");
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

/** A row as research only: no grade letter even from an older cached board. */
function researchRow(r: IndiaRow): Record<string, unknown> {
  const withoutGrade = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== "grade" && k !== "tier"));
  return {
    ...withoutGrade(r),
    ...(hasRadarDetail(r) ? { hazard: withoutGrade(r.hazard) } : {}),
    pd_research_only: true,
  };
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
  const published = tiersPublished(snap.board);
  return JSON.stringify(
    {
      region: "in",
      as_of: snap.board.as_of,
      stale: snap.stale ? { cached_at: snap.stale.savedAt } : null,
      market_regime: snap.regime,
      tier_publication: snap.board.tier_publication ?? null,
      ...(snap.board.access ? { access: snap.board.access } : {}),
      ...(snap.board.historical_evidence ? { historical_evidence: snap.board.historical_evidence } : {}),
      rows: sortRows(snap.board.rows, "risk").map((row) => {
        if (!published) return researchRow(row);
        return hasRadarDetail(row) ? { ...row, risk_band: riskBand(row) } : row;
      }),
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

/**
 * The ontology lens for people: identity, keys, links, events and one line per
 * coverage route. What the API withheld or trimmed is said up front, so a
 * partial answer never reads as a complete one.
 */
export function renderLens(answer: LensAnswer): string {
  const lines = ["LIQUILENS · ONTOLOGY CONTEXT"];
  if (answer.status === "ambiguous") {
    lines.push(`"${answer.query}" names more than one object, and none is picked.`);
    for (const candidate of answer.resolve.candidates ?? []) lines.push(`  ${candidate}`);
    lines.push("Ask again with one of these ids, or with a key such as a CIN.");
    return lines.join("\n");
  }
  if (answer.status === "not_found") {
    lines.push(
      answer.context
        ? `"${answer.query}" resolved to ${answer.resolve.id}, but the context route knows no object with that id.`
        : `"${answer.query}": not found. No object carries that name or key, and nothing is guessed or minted.`,
    );
    return lines.join("\n");
  }
  const { context, resolve } = answer;
  if (context.boundary) lines.push(context.boundary);
  for (const withheld of context.access?.withheld ?? []) {
    const needs = withheld.requires ? `; needs a ${withheld.requires} key` : "";
    lines.push(`withheld for this caller: ${withheld.depth}` + (withheld.what ? ` (${withheld.what}${needs})` : needs));
  }
  if (context.access?.withheld?.length && context.access.how_to_get_access) {
    lines.push(context.access.how_to_get_access);
  }
  const cuts = Object.entries(context.trimmed ?? {});
  if (cuts.length) {
    lines.push(`trimmed to fit the response budget: ${cuts.map(([path, n]) => `${path} ${n}`).join(", ")}`);
  }
  lines.push("", "IDENTITY", `  ${context.label}`, `  id: ${context.id}`);
  lines.push(`  kind: ${context.kind} · jurisdiction: ${context.jurisdiction} · authority: ${context.authority}`);
  lines.push(
    `  resolved from "${answer.query}" by ${resolve.rule ?? "the API"}` +
      (resolve.as_of ? `, as of ${resolve.as_of}` : ""),
  );
  if (context.redirected_from) lines.push(`  redirected from: ${context.redirected_from}`);
  if (context.note) lines.push(`  note: ${context.note}`);

  lines.push("", "KEYS");
  const keys = Object.entries(context.keys ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [space, key] of keys) lines.push(`  ${space}: ${key}`);
  if (!keys.length) lines.push("  none served");

  const links = context.links ?? { total: 0, by_kind: {}, sample: [] };
  const kinds = Object.entries(links.by_kind ?? {}).map(([kind, n]) => `${kind} ${n}`);
  lines.push("", `LINKS · ${links.total} in all` + (kinds.length ? ` (${kinds.join(", ")})` : ""));
  for (const link of links.sample ?? []) {
    lines.push(`  ${link.direction} ${link.kind} ${link.id}` + (link.label ? ` (${link.label})` : ""));
  }
  if ((links.sample ?? []).length < links.total) {
    lines.push(`  ${(links.sample ?? []).length} of ${links.total} shown`);
  }

  lines.push("", "EVENTS");
  for (const event of context.events ?? []) {
    lines.push(`  ${event.date ?? "undated"} ${event.id}`);
    if (event.label) lines.push(`    ${event.label}`);
  }
  if (!(context.events ?? []).length) lines.push("  no event object concerns this object");

  lines.push("", "COVERAGE · most specific first");
  (context.coverage ?? []).forEach((entry, i) => {
    lines.push(`  ${i + 1}. ${entry.product} · ${entry.topic}`);
    if (entry.mcp) {
      lines.push(`     mcp: ${entry.mcp.tool} ${JSON.stringify(entry.mcp.arguments ?? {})} on ${entry.mcp.server}`);
    }
    if (entry.rest) lines.push(`     rest: ${entry.rest}`);
    if (entry.site) lines.push(`     site: ${entry.site}`);
  });
  if (!(context.coverage ?? []).length) {
    lines.push("  no product read is routed for this object; that says nothing about the object itself");
  }

  if (context.view) {
    lines.push("", `VIEW · ${answer.view}`);
    for (const line of JSON.stringify(context.view, null, 2).split("\n")) lines.push(`  ${line}`);
  }
  lines.push("", `source: ${answer.url}`);
  return lines.join("\n");
}

/** The payload the API served, exactly: the context when the query resolved, else the resolve answer. */
export function renderLensJson(answer: LensAnswer): string {
  return JSON.stringify(answer.context ?? answer.resolve, null, 2);
}
