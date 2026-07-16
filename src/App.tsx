import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import {
  fetchBoard,
  fetchNews,
  fetchRegime,
  fetchUSBoard,
  type Board,
  type BoardRow,
  type MarketRegime,
  type NewsSignal,
  type USBoard,
  type USRow,
} from "./api.js";
import {
  loadCached,
  saveCached,
  ageMinutes,
  describeAge,
  type Region,
} from "./cache.js";
import {
  cell,
  computeCols,
  computeUSCols,
  filterRows,
  filterUSRows,
  fmtAssets,
  fundingLabel,
  movement,
  pct,
  pct1,
  rawPct,
  SORT_MODES,
  sortRows,
  sortUSRows,
  sparkline,
  US_SORT_MODES,
  viewport,
  type Cols,
  type SortMode,
  type USCols,
  type USSortMode,
} from "./format.js";
import { riskBand, usRiskBandByRank, bandColor } from "./riskBands.js";

const ACCENT = "#9184d9"; // Nocturne
const DIM = "gray";
const REFRESH_MS = 5 * 60_000;
const NEWS_DEBOUNCE_MS = 250;

function moveColor(dir: "up" | "down" | "flat"): string {
  if (dir === "up") return bandColor.red;
  if (dir === "down") return bandColor.green;
  return DIM;
}

function fundColor(band: string): string {
  if (band === "stable") return bandColor.green;
  if (band === "not_scored") return DIM;
  return bandColor.amber;
}

function regimeColor(regime: string): string {
  const r = regime.toUpperCase();
  if (r.includes("ALARM")) return bandColor.red;
  if (r.includes("SHIFT") || r.includes("WATCH")) return bandColor.amber;
  return bandColor.green;
}

function useTermSize(): { width: number; height: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    width: stdout?.columns ?? 80,
    height: stdout?.rows ?? 24,
  });
  useEffect(() => {
    if (!stdout) return;
    const onResize = () =>
      setSize({ width: stdout.columns ?? 80, height: stdout.rows ?? 24 });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}

function Header({
  region,
  regime,
  regimeError,
  usBoard,
  width,
}: {
  region: Region;
  regime: MarketRegime | null;
  regimeError: boolean;
  usBoard: USBoard | null;
  width: number;
}) {
  const spark =
    region === "in" && width >= 96 && regime?.series?.log_sr
      ? sparkline(regime.series.log_sr, 28)
      : "";
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={ACCENT} bold>
          ◆ LIQUILENS
        </Text>
        <Text color={DIM}> · Failure Radar · </Text>
        <Text color={region === "in" ? ACCENT : DIM} bold={region === "in"}>
          IN
        </Text>
        <Text color={DIM}>/</Text>
        <Text color={region === "us" ? ACCENT : DIM} bold={region === "us"}>
          US
        </Text>
        <Text color={DIM}> (t to switch)</Text>
      </Box>
      {region === "in" ? (
        regime ? (
          <Box>
            <Text color={DIM}>market regime </Text>
            <Text color={regimeColor(regime.regime)} bold>
              {regime.regime}
            </Text>
            <Text color={DIM}>
              {" "}
              (log-SR {regime.log_sr_now.toFixed(2)}, last change{" "}
              {regime.trading_days_since_last_change}d ago)
            </Text>
            {spark && (
              <Text color={regimeColor(regime.regime)}> {spark}</Text>
            )}
            <Text color={DIM}> · {regime.as_of}</Text>
          </Box>
        ) : regimeError ? (
          <Text color={DIM}>market regime unavailable right now</Text>
        ) : null
      ) : usBoard ? (
        <Text color={DIM}>
          top {usBoard.board.length} of {usBoard.universe.banks_scored} FDIC
          banks (≥$1B assets) · undertow score = within-quarter percentile ·
          quarter {usBoard.as_of}
        </Text>
      ) : null}
    </Box>
  );
}

function InRow({
  row,
  selected,
  cols,
}: {
  row: BoardRow;
  selected: boolean;
  cols: Cols;
}) {
  const band = riskBand(row);
  const move = movement(row.movement.delta_pd_12m);
  return (
    <Box>
      <Text color={selected ? ACCENT : DIM}>{selected ? "❯ " : "  "}</Text>
      <Text color={bandColor[band]} bold={selected} inverse={selected}>
        {cell(row.name, cols.name)}
      </Text>
      <Text color={DIM}>{cell(row.inst_type, cols.type)}</Text>
      <Text color={bandColor[band]}>{cell(row.grade, cols.grade)}</Text>
      <Text>{cell(String(row.score), cols.score)}</Text>
      <Text color={bandColor[band]}>{cell(pct(row.hazard.pd_12m), cols.pd)}</Text>
      <Text color={moveColor(move.dir)}>{cell(move.text, cols.move)}</Text>
      <Text color={fundColor(row.funding.band)}>
        {fundingLabel(row.funding.band)}
      </Text>
    </Box>
  );
}

function UsRow({
  row,
  rank,
  selected,
  cols,
}: {
  row: USRow;
  rank: number;
  selected: boolean;
  cols: USCols;
}) {
  const band = usRiskBandByRank(rank);
  return (
    <Box>
      <Text color={selected ? ACCENT : DIM}>{selected ? "❯ " : "  "}</Text>
      <Text color={bandColor[band]} bold={selected} inverse={selected}>
        {cell(row.bank, cols.bank)}
      </Text>
      <Text color={DIM}>{cell(row.state, cols.state)}</Text>
      <Text>{cell(fmtAssets(row.assets_usd_k), cols.assets)}</Text>
      <Text color={bandColor[band]}>
        {cell(row.undertow_score_v02.toFixed(3), cols.score)}
      </Text>
      <Text>{cell(rawPct(row.noncurrent_ratio), cols.noncurr)}</Text>
      <Text>{cell(pct1(row.uninsured_ratio), cols.uninsured)}</Text>
      <Text color={DIM}>{pct1(row.ndfi_to_tier1)}</Text>
    </Box>
  );
}

function NewsLine({ news }: { news: NewsSignal | "loading" | "error" | null }) {
  if (news === null) return null;
  if (news === "loading") return <Text color={DIM}>news watch loading…</Text>;
  if (news === "error") return <Text color={DIM}>news watch unavailable</Text>;
  const stressColor =
    news.news_stress >= 50
      ? bandColor.red
      : news.news_stress >= 20
        ? bandColor.amber
        : bandColor.green;
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={DIM}>news watch  stress </Text>
        <Text color={stressColor} bold>
          {news.news_stress.toFixed(1)}
        </Text>
        <Text color={DIM}>
          {"  "}tone {news.tone_recent.toFixed(2)} · distress share{" "}
          {pct(news.distress_share)} · coverage {news.coverage}
        </Text>
      </Text>
      {news.basis.slice(0, 2).map((b, i) => (
        <Text key={i} color={DIM}>
          · {b}
        </Text>
      ))}
    </Box>
  );
}

function InDetail({
  row,
  news,
}: {
  row: BoardRow;
  news: NewsSignal | "loading" | "error" | null;
}) {
  const band = riskBand(row);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      <Box justifyContent="space-between" gap={2}>
        <Text bold color={bandColor[band]}>
          {row.name}
        </Text>
        <Text color={DIM}>
          {row.inst_type} · {row.quarter} · data as of {row.as_of} (
          {row.age_months}mo old)
        </Text>
      </Box>
      <Text>
        <Text color={DIM}>grade </Text>
        <Text bold>{row.grade}</Text>
        <Text color={DIM}>  score </Text>
        <Text bold>{row.score}</Text>
        <Text color={DIM}>  PD 12/24/36m </Text>
        <Text bold color={bandColor[band]}>
          {pct(row.hazard.pd_12m)} / {pct(row.hazard.pd_24m)} /{" "}
          {pct(row.hazard.pd_36m)}
        </Text>
      </Text>
      {row.hazard.basis.length > 0 && (
        <Text color={DIM}>hazard basis: {row.hazard.basis.join("; ")}</Text>
      )}
      <Text>
        <Text color={DIM}>funding </Text>
        <Text color={fundColor(row.funding.band)}>
          {fundingLabel(row.funding.band)}
        </Text>
        {row.funding.flags.length > 0 && (
          <Text color={bandColor.amber}> ⚑ {row.funding.flags.join(", ")}</Text>
        )}
        {row.funding.basis.length > 0 && (
          <Text color={DIM}> — {row.funding.basis.join("; ")}</Text>
        )}
      </Text>
      <Text>
        <Text color={DIM}>PCA </Text>
        <Text>{row.pca.status}</Text>
        {row.pca.breaches.length > 0 && (
          <Text color={bandColor.red}> breaches: {row.pca.breaches.join(", ")}</Text>
        )}
      </Text>
      <Text>
        <Text color={DIM}>forensics </Text>
        {row.forensics.fired ? (
          <Text color={bandColor.red}>
            FIRED: {row.forensics.indicators.join(", ")}
          </Text>
        ) : (
          <Text color={bandColor.green}>clear</Text>
        )}
      </Text>
      {row.market && !row.market.stale && (
        <Text>
          <Text color={DIM}>market lens  DD </Text>
          <Text bold>{row.market.dd.toFixed(2)}</Text>
          <Text color={DIM}>  Merton PD 1y </Text>
          <Text bold>{pct(row.market.pd_merton_1y)}</Text>
        </Text>
      )}
      <NewsLine news={news} />
    </Box>
  );
}

function UsDetail({ row, rank }: { row: USRow; rank: number }) {
  const band = usRiskBandByRank(rank);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      <Box justifyContent="space-between" gap={2}>
        <Text bold color={bandColor[band]}>
          {row.bank}
        </Text>
        <Text color={DIM}>
          {row.state} · FDIC cert {row.cert} · {fmtAssets(row.assets_usd_k)}{" "}
          assets
        </Text>
      </Box>
      <Text>
        <Text color={DIM}>undertow score </Text>
        <Text bold color={bandColor[band]}>
          {row.undertow_score_v02.toFixed(4)}
        </Text>
        <Text color={DIM}>
          {"  "}(#{rank + 1} riskiest · within-quarter percentile ·{" "}
          {row.signals_available} signals)
        </Text>
      </Text>
      <Text>
        <Text color={DIM}>noncurrent assets </Text>
        <Text bold>{rawPct(row.noncurrent_ratio)}</Text>
        <Text color={DIM}>  uninsured deposits </Text>
        <Text bold>{pct1(row.uninsured_ratio)}</Text>
        <Text color={DIM}>  brokered deposits </Text>
        <Text bold>{pct1(row.brokered_ratio)}</Text>
      </Text>
      <Text>
        <Text color={DIM}>CRE concentration </Text>
        <Text bold>{pct1(row.cre_concentration)}</Text>
        <Text color={DIM}>  NDFI exposure / tier-1 </Text>
        <Text bold>{pct1(row.ndfi_to_tier1)}</Text>
      </Text>
      <Text color={DIM}>
        source: FDIC BankFind Suite (public domain) · undertow engine ·
        relative rank, not a PD
      </Text>
    </Box>
  );
}

export default function App({ initialRegion = "in" }: { initialRegion?: Region }) {
  const { exit } = useApp();
  const { width, height } = useTermSize();
  const [region, setRegion] = useState<Region>(initialRegion);

  const [board, setBoard] = useState<Board | null>(null);
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [regimeError, setRegimeError] = useState(false);
  const [usBoard, setUsBoard] = useState<USBoard | null>(null);
  const [staleFrom, setStaleFrom] = useState<Record<Region, string | null>>({
    in: null,
    us: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [cursor, setCursor] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [inSort, setInSort] = useState<SortMode>("risk");
  const [usSort, setUsSort] = useState<USSortMode>("risk");
  const [filterMode, setFilterMode] = useState(false);
  const [query, setQuery] = useState("");
  const [news, setNews] = useState<NewsSignal | "loading" | "error" | null>(null);
  const newsCache = useRef(new Map<string, NewsSignal>());
  const loadSeq = useRef(0);

  const loadIn = useCallback(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    Promise.allSettled([fetchBoard(), fetchRegime()]).then(
      ([boardRes, regimeRes]) => {
        if (seq !== loadSeq.current) return;
        setLoading(false);
        const gotRegime =
          regimeRes.status === "fulfilled" ? regimeRes.value : null;
        setRegimeError(regimeRes.status === "rejected");
        if (boardRes.status === "fulfilled") {
          setBoard(boardRes.value);
          setStaleFrom((s) => ({ ...s, in: null }));
          if (gotRegime) setRegime(gotRegime);
          saveCached("in", { board: boardRes.value, regime: gotRegime });
          return;
        }
        const cached = loadCached<{ board: Board; regime: MarketRegime | null }>(
          "in",
        );
        if (cached) {
          setBoard(cached.data.board);
          setRegime(gotRegime ?? cached.data.regime);
          setStaleFrom((s) => ({ ...s, in: cached.savedAt }));
        } else {
          setError(String(boardRes.reason?.message ?? boardRes.reason));
        }
      },
    );
  }, []);

  const loadUs = useCallback(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    fetchUSBoard()
      .then((b) => {
        if (seq !== loadSeq.current) return;
        setUsBoard(b);
        setStaleFrom((s) => ({ ...s, us: null }));
        saveCached("us", b);
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        const cached = loadCached<USBoard>("us");
        if (cached) {
          setUsBoard(cached.data);
          setStaleFrom((s) => ({ ...s, us: cached.savedAt }));
        } else {
          setError(String(err?.message ?? err));
        }
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }, []);

  const load = useCallback(
    (r: Region = region) => (r === "in" ? loadIn() : loadUs()),
    [region, loadIn, loadUs],
  );

  // Initial load only — later loads are user- or timer-driven.
  useEffect(() => {
    load(region);
  }, []);
  useEffect(() => {
    const t = setInterval(() => load(region), REFRESH_MS);
    return () => clearInterval(t);
  }, [load, region]);

  const inRows = useMemo(
    () => sortRows(filterRows(board?.rows ?? [], query), inSort),
    [board, query, inSort],
  );
  // US rank (risk position) must be computed on the risk ordering, then we
  // re-sort for display so colours stay stable across sort modes.
  const usRows = useMemo(() => {
    const byRisk = sortUSRows(usBoard?.board ?? [], "risk");
    const rank = new Map(byRisk.map((r, i) => [r.cert, i]));
    return sortUSRows(filterUSRows(byRisk, query), usSort).map((r) => ({
      row: r,
      rank: rank.get(r.cert) ?? 99,
    }));
  }, [usBoard, query, usSort]);

  const rowCount = region === "in" ? inRows.length : usRows.length;

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, rowCount - 1)));
  }, [rowCount]);

  // Debounced lazy news for the selected Indian institution.
  const selectedIn = region === "in" ? inRows[cursor] : undefined;
  useEffect(() => {
    if (!showDetail || !selectedIn) {
      setNews(null);
      return;
    }
    const hit = newsCache.current.get(selectedIn.slug);
    if (hit) {
      setNews(hit);
      return;
    }
    let cancelled = false;
    setNews("loading");
    const timer = setTimeout(() => {
      fetchNews(selectedIn.slug)
        .then((n) => {
          newsCache.current.set(selectedIn.slug, n);
          if (!cancelled) setNews(n);
        })
        .catch(() => {
          if (!cancelled) setNews("error");
        });
    }, NEWS_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showDetail, selectedIn?.slug]);

  useInput(
    (input, key) => {
      if (filterMode) {
        if (key.escape) {
          setFilterMode(false);
          setQuery("");
        } else if (key.return) {
          setFilterMode(false);
        } else if (key.backspace || key.delete) {
          setQuery((q) => q.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta) {
          setQuery((q) => q + input);
        }
        return;
      }
      if (input === "q" || (key.ctrl && input === "c")) exit();
      if (input === "r") load(region);
      if (input === "t") {
        const next: Region = region === "in" ? "us" : "in";
        setRegion(next);
        setCursor(0);
        setShowDetail(false);
        setQuery("");
        if (next === "us" && !usBoard) loadUs();
        if (next === "in" && !board) loadIn();
      }
      if (input === "s") {
        if (region === "in")
          setInSort(
            (m) => SORT_MODES[(SORT_MODES.indexOf(m) + 1) % SORT_MODES.length]!,
          );
        else
          setUsSort(
            (m) =>
              US_SORT_MODES[(US_SORT_MODES.indexOf(m) + 1) % US_SORT_MODES.length]!,
          );
      }
      if (input === "/") setFilterMode(true);
      if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow || input === "j")
        setCursor((c) => Math.min(rowCount - 1, c + 1));
      if (key.return) setShowDetail((d) => !d);
      if (key.escape) {
        if (showDetail) setShowDetail(false);
        else if (query) setQuery("");
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  const cols = useMemo(() => computeCols(width), [width]);
  const usCols = useMemo(() => computeUSCols(width), [width]);
  const hasData = region === "in" ? board !== null : usBoard !== null;
  const regionStale = staleFrom[region];
  const sortMode = region === "in" ? inSort : usSort;

  const chrome = 7 + (showDetail ? 13 : 0) + (regionStale ? 1 : 0);
  const visible = Math.max(3, height - chrome);
  const vp = viewport(rowCount, visible, cursor);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        region={region}
        regime={regime}
        regimeError={regimeError}
        usBoard={usBoard}
        width={width}
      />
      {regionStale && (
        <Text color={bandColor.amber}>
          ⚠ offline — showing cached board from{" "}
          {describeAge(ageMinutes(regionStale))} (retrying every 5m, r to retry
          now)
        </Text>
      )}
      {error && (
        <Text color={bandColor.red}>
          ✖ {error} — press r to retry, or set LIQUILENS_API / HTTPS_PROXY
        </Text>
      )}
      {loading && !hasData && <Text color={DIM}>⠿ loading live board…</Text>}
      {hasData && (
        <Box flexDirection="column" marginTop={1}>
          {region === "in" ? (
            <Text color={DIM} bold>
              {"  "}
              {cell("INSTITUTION", cols.name)}
              {cell("TYPE", cols.type)}
              {cell("GRADE", cols.grade)}
              {cell("SCORE", cols.score)}
              {cell("PD 12M", cols.pd)}
              {cell("Δ PD", cols.move)}
              {"FUNDING"}
            </Text>
          ) : (
            <Text color={DIM} bold>
              {"  "}
              {cell("BANK", usCols.bank)}
              {cell("STATE", usCols.state)}
              {cell("ASSETS", usCols.assets)}
              {cell("SCORE", usCols.score)}
              {cell("NONCURR", usCols.noncurr)}
              {cell("UNINSURED", usCols.uninsured)}
              {"NDFI/T1"}
            </Text>
          )}
          {vp.above > 0 && <Text color={DIM}>{"  "}↑ {vp.above} more</Text>}
          {region === "in"
            ? inRows
                .slice(vp.start, vp.end)
                .map((row, i) => (
                  <InRow
                    key={row.slug}
                    row={row}
                    selected={vp.start + i === cursor}
                    cols={cols}
                  />
                ))
            : usRows
                .slice(vp.start, vp.end)
                .map(({ row, rank }, i) => (
                  <UsRow
                    key={row.cert}
                    row={row}
                    rank={rank}
                    selected={vp.start + i === cursor}
                    cols={usCols}
                  />
                ))}
          {vp.below > 0 && <Text color={DIM}>{"  "}↓ {vp.below} more</Text>}
          {rowCount === 0 && (
            <Text color={DIM}>{"  "}no institutions match "{query}"</Text>
          )}
          {showDetail && region === "in" && selectedIn && (
            <Box marginTop={1}>
              <InDetail row={selectedIn} news={news} />
            </Box>
          )}
          {showDetail && region === "us" && usRows[cursor] && (
            <Box marginTop={1}>
              <UsDetail row={usRows[cursor].row} rank={usRows[cursor].rank} />
            </Box>
          )}
        </Box>
      )}
      {(filterMode || query) && (
        <Text>
          <Text color={ACCENT}>/</Text>
          <Text>{query}</Text>
          {filterMode && <Text color={ACCENT}>▏</Text>}
          <Text color={DIM}>
            {"  "}({rowCount} match{rowCount === 1 ? "" : "es"}
            {filterMode ? ", ⏎ keep · esc clear" : ", esc clear"})
          </Text>
        </Text>
      )}
      <Box marginTop={1}>
        <Text color={DIM} wrap="truncate">
          ↑↓ select · ⏎ detail · t region · s sort ({sortMode}) · / filter · r
          refresh · q quit
          {region === "in" && board ? `  ·  as of ${board.as_of}` : ""}
          {region === "us" && usBoard ? `  ·  quarter ${usBoard.as_of}` : ""}
          {"  ·  liquilens.in"}
          {loading && hasData ? "  ·  refreshing…" : ""}
        </Text>
      </Box>
    </Box>
  );
}
