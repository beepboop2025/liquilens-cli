#!/usr/bin/env node
import dns from "node:dns";
import { createRequire } from "node:module";
import React from "react";
import { render } from "ink";
import App from "./App.js";
import {
  fetchBoard,
  fetchEvidenceMarkets,
  fetchRegime,
  fetchUSBoard,
  lookupContext,
  setApiBase,
  setClientVersion,
  getApiBase,
  DEFAULT_API,
  LENS_VIEWS,
  type Board,
  type LensAnswer,
  type LensView,
  type MarketRegime,
  type USBoard,
} from "./api.js";
import {
  loadCached,
  saveCached,
  ageMinutes,
  describeAge,
  type Region,
} from "./cache.js";
import {
  renderEvidenceJson,
  renderEvidenceRecord,
  renderJson,
  renderLens,
  renderLensJson,
  renderPlain,
  worstBand,
  type Snapshot,
} from "./plain.js";
import { bandAtLeast, type RiskBand } from "./riskBands.js";

// Some networks blackhole IPv6 (Node's fetch hangs while curl works);
// prefer IPv4 first; undici's autoSelectFamily in api.ts covers the rest.
dns.setDefaultResultOrder("ipv4first");

// A crash should read like a message, not a stack dump, and must not leave
// the terminal in raw mode (Ink's unmount handles restore on normal exits).
function crash(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nliquilens: unexpected error: ${msg}\n`);
  process.stderr.write("Run again with --plain for a minimal path, or check --help.\n");
  process.exit(1);
}
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
setClientVersion(version);

const HELP = `liquilens ${version}: LiquiLens in your terminal

Usage: liquilens [options]
       liquilens lens <name, key or id> [--view <view>] [--as-of <date>] [--json] [--api <url>]

Runs an interactive dashboard when attached to a terminal; falls back to a
plain table when piped. Data comes from public, no-auth LiquiLens endpoints.

Options:
  --region <in|us>   board to show (default in). in = India institutions,
                     us = FDIC-scored US banks (undertow engine)
  --record           one-shot historical-evidence status for India, the US,
                     and Europe, including validated/real-money eligibility.
                     Cannot be combined with --region or --fail-on.
  --plain            one-shot ANSI-free table (default when stdout is not a TTY)
  --json             one-shot machine-readable JSON dump
  --fail-on <band>   exit 3 if any institution is at/above band (amber|red).
                     India board only; the US board is a relative leaderboard.
                     Implies --plain unless --json is given. For cron/CI alerts.
                     Exits 4 if tiers are paused or detailed inputs are unavailable.
  --api <url>        API host (default ${DEFAULT_API}; env LIQUILENS_API)
  -h, --help         show this help
  -v, --version      show version

Ontology lens (one-shot):
  lens <query>       resolve a name, any key (CIN, LEI, ISIN, CUSIP, slug) or a
                     canonical id, then print the object's identity, keys,
                     links, events and every product read (LiquiLens, Seiche,
                     Undertow, Palimpsest) that serves data about it. Identity
                     and routing only, not evidence: the product that answers
                     owns its answer.
  --view <view>      summary (default), relationships, timeline, provenance or
                     neighbourhood
  --as-of <date>     read the name and the view on YYYY-MM-DD
  --json             the payload the API served, unchanged

Environment:
  LIQUILENS_API      same as --api
  HTTPS_PROXY        honored for all requests (CONNECT proxy)

Keys (interactive): ↑↓/jk select · ⏎ detail · t region · s sort · / filter ·
                    r refresh · q quit
Exit codes: 0 ok · 1 no data (API down and no cache) · 2 bad usage ·
            3 --fail-on threshold breached ·
            4 --fail-on could not evaluate the board (tiers paused or detailed inputs unavailable)
            lens: 0 answered (resolved, ambiguous or not found) · 1 the API
            could not answer (unreachable, an error, or no context route)`;

function fail(msg: string, code: number): never {
  process.stderr.write(`liquilens: ${msg}\n`);
  process.exit(code);
}

interface Args {
  mode: "tui" | "plain" | "json";
  region: Region;
  failOn: RiskBand | null;
  record: boolean;
  lens: { query: string; view: LensView; asOf: string | null } | null;
}

/** A calendar date written YYYY-MM-DD (no rollover: 2026-02-30 is refused). */
function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const day = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text;
}

export function parseArgs(
  argv: string[],
  isTTY: boolean,
): Args | { exit: string } {
  let mode: "tui" | "plain" | "json" | null = null;
  let region: Region = "in";
  let regionExplicit = false;
  let failOn: RiskBand | null = null;
  let record = false;
  const lens = argv[0] === "lens";
  let query: string | null = null;
  let view: LensView = "summary";
  let viewExplicit = false;
  let asOf: string | null = null;
  for (let i = lens ? 1 : 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "-h":
      case "--help":
        return { exit: HELP };
      case "-v":
      case "--version":
        return { exit: version };
      case "--plain":
        mode = "plain";
        break;
      case "--json":
        mode = "json";
        break;
      case "--record":
        record = true;
        break;
      case "--region": {
        const r = argv[++i];
        if (r !== "in" && r !== "us")
          fail(`--region must be "in" or "us", got "${r ?? ""}"`, 2);
        region = r;
        regionExplicit = true;
        break;
      }
      case "--fail-on": {
        const b = argv[++i];
        if (b !== "amber" && b !== "red")
          fail(`--fail-on must be "amber" or "red", got "${b ?? ""}"`, 2);
        failOn = b;
        break;
      }
      case "--api": {
        const url = argv[++i];
        if (!url || !/^https?:\/\//.test(url))
          fail("--api needs an http(s):// URL", 2);
        setApiBase(url);
        break;
      }
      case "--view": {
        const v = argv[++i];
        if (!LENS_VIEWS.includes(v as LensView))
          fail(`--view must be one of ${LENS_VIEWS.join(", ")}, got "${v ?? ""}"`, 2);
        view = v as LensView;
        viewExplicit = true;
        break;
      }
      case "--as-of": {
        const d = argv[++i];
        if (!d || !isDay(d)) fail(`--as-of must be a date written YYYY-MM-DD, got "${d ?? ""}"`, 2);
        asOf = d;
        break;
      }
      default:
        if (lens && !arg.startsWith("-")) {
          if (query !== null)
            fail(`lens takes one query; quote a name with spaces, as in liquilens lens "IDBI Bank Ltd"`, 2);
          query = arg;
          break;
        }
        fail(`unknown option "${arg}" (try --help)`, 2);
    }
  }
  if (!lens && (viewExplicit || asOf !== null))
    fail("--view and --as-of work with lens only (try --help)", 2);
  if (lens) {
    if (regionExplicit || record || failOn)
      fail("lens cannot be combined with --region, --record or --fail-on; it reads one object", 2);
    const text = (query ?? "").trim();
    if (text.length < 1 || text.length > 200)
      fail(`lens needs a name, key or id of 1 to 200 characters, as in liquilens lens "IDBI Bank Ltd"`, 2);
    return {
      mode: mode === "json" ? "json" : "plain",
      region,
      failOn,
      record,
      lens: { query: text, view, asOf },
    };
  }
  if (failOn && region === "us")
    fail(
      "--fail-on works with --region in only: US scores are within-quarter " +
        "percentile ranks (a relative leaderboard), so an absolute alert " +
        "threshold would always fire",
      2,
    );
  if (record && regionExplicit)
    fail("--record cannot be combined with --region; it already covers every market", 2);
  if (record && failOn)
    fail("--record cannot be combined with --fail-on; evidence eligibility is not a risk band", 2);
  if (record && mode === null) mode = "plain";
  if (failOn && mode === null) mode = "plain";
  return { mode: mode ?? (isTTY ? "tui" : "plain"), region, failOn, record, lens: null };
}

async function snapshotOnce(region: Region): Promise<Snapshot> {
  if (region === "us") {
    try {
      const board = await fetchUSBoard();
      saveCached<USBoard>("us", board);
      return { region: "us", board, stale: null };
    } catch (err) {
      const cached = loadCached<USBoard>("us");
      if (cached) {
        return {
          region: "us",
          board: cached.data,
          stale: {
            savedAt: cached.savedAt,
            description: describeAge(ageMinutes(cached.savedAt)),
          },
        };
      }
      fail(
        `could not reach ${getApiBase()} and no cached data exists ` +
          `(${err instanceof Error ? err.message : String(err)})`,
        1,
      );
    }
  }
  const [boardRes, regimeRes] = await Promise.allSettled([
    fetchBoard(),
    fetchRegime(),
  ]);
  const regime = regimeRes.status === "fulfilled" ? regimeRes.value : null;
  if (boardRes.status === "fulfilled") {
    saveCached<{ board: Board; regime: MarketRegime | null }>("in", {
      board: boardRes.value,
      regime,
    });
    return { region: "in", board: boardRes.value, regime, stale: null };
  }
  const cached = loadCached<{ board: Board; regime: MarketRegime | null }>("in");
  if (cached) {
    return {
      region: "in",
      board: cached.data.board,
      regime: regime ?? cached.data.regime,
      stale: {
        savedAt: cached.savedAt,
        description: describeAge(ageMinutes(cached.savedAt)),
      },
    };
  }
  const reason = boardRes.reason;
  fail(
    `could not reach ${getApiBase()} and no cached data exists ` +
      `(${reason instanceof Error ? reason.message : String(reason)})`,
    1,
  );
}

const parsed = parseArgs(process.argv.slice(2), process.stdout.isTTY === true);
if ("exit" in parsed) {
  console.log(parsed.exit);
  process.exit(0);
}

if (parsed.lens) {
  let answer: LensAnswer;
  try {
    answer = await lookupContext(parsed.lens.query, parsed.lens.view, parsed.lens.asOf);
  } catch (err) {
    fail(
      `could not read the ontology context from ${getApiBase()} ` +
        `(${err instanceof Error ? err.message : String(err)})`,
      1,
    );
  }
  console.log(parsed.mode === "json" ? renderLensJson(answer) : renderLens(answer));
} else if (parsed.record) {
  try {
    const record = await fetchEvidenceMarkets();
    console.log(
      parsed.mode === "json"
        ? renderEvidenceJson(record)
        : renderEvidenceRecord(record),
    );
  } catch (err) {
    fail(
      `could not read historical evidence from ${getApiBase()} ` +
        `(${err instanceof Error ? err.message : String(err)})`,
      1,
    );
  }
} else if (parsed.mode === "tui") {
  render(<App initialRegion={parsed.region} />);
} else {
  const snap = await snapshotOnce(parsed.region);
  const width =
    process.stdout.columns && process.stdout.isTTY
      ? process.stdout.columns
      : 110;
  console.log(parsed.mode === "json" ? renderJson(snap) : renderPlain(snap, width));
  if (parsed.failOn) {
    const worst = worstBand(snap);
    if (worst === null) {
      // Never a silent pass: a paused board is not a calm board.
      process.stderr.write(
        `liquilens: --fail-on ${parsed.failOn} not evaluated: published tiers and detailed risk inputs are required\n`,
      );
      process.exit(4);
    }
    if (bandAtLeast(worst, parsed.failOn)) {
      process.stderr.write(
        `liquilens: --fail-on ${parsed.failOn} breached\n`,
      );
      process.exit(3);
    }
  }
}
