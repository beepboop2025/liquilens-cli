import {
  fetch as undiciFetch,
  Agent,
  EnvHttpProxyAgent,
  type Dispatcher,
} from "undici";

export const DEFAULT_API = "https://api.liquilens.in";

let apiBase = process.env.LIQUILENS_API ?? DEFAULT_API;
let clientVersion = "dev";

export function setApiBase(url: string): void {
  apiBase = url.replace(/\/+$/, "");
}

export function getApiBase(): string {
  return apiBase;
}

export function setClientVersion(version: string): void {
  clientVersion = version;
}

const CONNECT_OPTS = {
  timeout: 10_000,
  // Real Happy Eyeballs with a fast fallback: survives networks that
  // blackhole IPv6 after connect, and still works on IPv6-only networks.
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 300,
} as const;

const hasProxyEnv = Boolean(
  process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy,
);

const dispatcher: Dispatcher = hasProxyEnv
  ? new EnvHttpProxyAgent({ connect: CONNECT_OPTS })
  : new Agent({ connect: CONNECT_OPTS });

type Fetch = typeof undiciFetch;
let fetchImpl: Fetch = undiciFetch;

/** Swap the network for a stub in tests; `null` restores undici's fetch. */
export function setFetch(next: Fetch | null): void {
  fetchImpl = next ?? undiciFetch;
}

/** An HTTP error status from the API, with the JSON body of a 4xx answer when it sent one. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, path: string, body?: unknown) {
    super(`HTTP ${status} from ${path}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export interface BoardRow {
  slug: string;
  name: string;
  inst_type: string;
  label: string;
  as_of: string;
  quarter: string;
  age_months: number;
  score: number;
  /** Served only while review tiers are published. */
  grade?: string;
  hazard: {
    pd_12m: number;
    pd_24m: number;
    pd_36m: number;
    /** Served only while review tiers are published. */
    grade?: string;
    drivers: Record<string, number>;
    basis: string[];
  };
  movement: {
    delta_pd_12m: number;
    reference?: { from_q: string; from_period: string; pd_12m_then: number };
  };
  pca: {
    applicable: boolean;
    status: string;
    risk_level: number;
    breaches: string[];
    note?: string;
  };
  funding: {
    index: number;
    band: string;
    flags: string[];
    basis: string[];
  };
  forensics: { eligible: boolean; fired: boolean; indicators: string[] };
  market?: {
    dd: number;
    pd_merton_1y: number;
    stale: boolean;
    basis: string[];
  } | null;
}

/** The anonymous radar view serves current figures without their detailed inputs. */
export interface PublicBoardRow
  extends Pick<BoardRow, "slug" | "name" | "inst_type" | "as_of" | "quarter" | "score" | "grade"> {
  pd_12m: number | null;
  pd_24m: number | null;
  pd_36m: number | null;
  delta_pd_12m: number | null;
  funding_index: number | null;
  rbi_zone: string | null;
  pd_research_only?: boolean;
}

export type IndiaRow = BoardRow | PublicBoardRow;

export function hasRadarDetail(row: IndiaRow): row is BoardRow {
  return "hazard" in row;
}

export function probabilities(row: IndiaRow) {
  return hasRadarDetail(row) ? row.hazard : row;
}

export function probabilityChange(row: IndiaRow) {
  return hasRadarDetail(row) ? row.movement.delta_pd_12m : row.delta_pd_12m;
}

/** The API's one tier-publication switch, served with every India board. */
export interface TierPublication {
  state: string;
  since: string;
  label: string;
  reason: string;
  revalidation_condition: string;
}

export interface Board {
  as_of: string;
  rows: IndiaRow[];
  access?: Record<string, unknown>;
  historical_evidence?: HistoricalEvidenceStatus;
  method_note?: string;
  tier_publication?: TierPublication;
}

export interface MarketRegime {
  available: boolean;
  as_of: string;
  stale: boolean;
  regime: string;
  log_sr_now: number;
  thresholds: { watch: number; alarm: number; recent_shift_days: number };
  trading_days_since_last_change: number;
  series?: { dates: string[]; log_sr?: number[]; entropy?: number[] };
}

export interface USRow {
  cert: number;
  bank: string;
  state: string;
  assets_usd_k: number;
  undertow_score_v02: number;
  signals_available: number;
  uninsured_ratio: number | null;
  brokered_ratio: number | null;
  noncurrent_ratio: number | null; // already in percent units (4.0 = 4%)
  cre_concentration: number | null;
  ndfi_to_tier1: number | null;
}

export interface USBoard {
  as_of: string;
  universe: { banks_scored: number; min_assets_usd_k: number; weights: string };
  board: USRow[];
  provenance: {
    source: string;
    engine: string;
    score_semantics: string;
    cadence?: string;
  };
}

interface ComputedNewsSignal {
  slug: string;
  attention_z: number;
  tone_recent: number;
  distress_share: number;
  news_stress: number;
  coverage: string;
  as_of: string;
  stale: boolean;
  basis: string[];
}

export type NewsSignal = ComputedNewsSignal | { slug: string; not_computed: string };

export interface HistoricalEvidenceStatus {
  status: string;
  validated_backtest_eligible: boolean;
  real_money_eligible: boolean;
  [key: string]: unknown;
}

export interface EvidenceMarket {
  key: string;
  name: string;
  kind: string;
  headline: string;
  institutions: number;
  historical_evidence: HistoricalEvidenceStatus;
}

export interface EvidenceMarketsResponse {
  markets: EvidenceMarket[];
}

const RETRIES = 3;
const ATTEMPT_TIMEOUT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJson<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetchImpl(`${apiBase}${path}`, {
        dispatcher,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        // These identify the product surface, not the person or machine. The
        // API aggregates successful board reads by this allow-listed value;
        // there is no client-side telemetry, cookie, or installation ID.
        headers: {
          "user-agent": `liquilens-cli/${clientVersion}`,
          "x-liquilens-client": "cli",
        },
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status, path);
      } else if (!res.ok) {
        throw new HttpError(res.status, path, await res.json().catch(() => undefined));
      } else {
        return (await res.json()) as T;
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("HTTP 4")) throw err;
      lastErr = err;
    }
    if (attempt < RETRIES - 1) await sleep(500 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const fetchBoard = () => getJson<Board>("/api/failure-radar/board");
export const fetchUSBoard = () => getJson<USBoard>("/api/us-radar/board");
export const fetchRegime = () =>
  getJson<MarketRegime>("/api/public-signals/market-regime");
export const fetchNews = (slug: string) =>
  getJson<NewsSignal>(`/api/public-signals/news/${encodeURIComponent(slug)}`);
export const fetchEvidenceMarkets = () =>
  getJson<EvidenceMarketsResponse>("/api/evidence/markets");

// ---------------------------------------------------------------------------
// Ontology lens: identity and routing for one name, key or id. Never evidence.
// ---------------------------------------------------------------------------

const ONTOLOGY = "/api/experimental/v1/ontology";

/** kind:jurisdiction/authority/name, each segment lowercase letters, digits and hyphens. */
const CANONICAL_ID = /^[a-z]+:[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/;

export const LENS_VIEWS = ["summary", "relationships", "timeline", "provenance", "neighbourhood"] as const;
export type LensView = (typeof LENS_VIEWS)[number];

/** `GET .../ontology/resolve`: one id, the candidates of an ambiguous name, or not_found. */
export interface OntologyResolve {
  schema?: string;
  status: "resolved" | "ambiguous" | "not_found";
  id?: string;
  rule?: string;
  candidates?: string[];
  query?: string;
  reason?: string;
  as_of?: string;
  [key: string]: unknown;
}

/** One product read that serves data about the object, with how to ask for it. */
export interface CoverageEntry {
  product: string;
  topic: string;
  mcp?: { server: string; tool: string; arguments: Record<string, unknown> };
  rest?: string;
  site?: string;
}

/** `GET .../ontology/objects/{id}/context` (schema liquilens.ontology-context.v1). */
export interface OntologyContext {
  schema: string;
  status: "resolved";
  id: string;
  redirected_from?: string;
  kind: string;
  label: string;
  jurisdiction: string;
  authority: string;
  note?: string;
  keys: Record<string, string>;
  links: {
    total: number;
    by_kind: Record<string, number>;
    sample: { kind: string; direction: string; id: string; label?: string }[];
  };
  events: { id: string; label?: string; date?: string | null }[];
  coverage: CoverageEntry[];
  view: Record<string, unknown> | null;
  as_of?: string | null;
  trimmed?: Record<string, number>;
  boundary?: string;
  access?: {
    tier?: string;
    withheld?: { depth: string; what?: string; requires?: string }[];
    how_to_get_access?: string;
  };
  [key: string]: unknown;
}

/** The context route's 404 answer for an id that no object has. */
export interface OntologyNotFound {
  schema?: string;
  status: "not_found";
  id?: string;
}

export type LensAnswer =
  | {
      status: "resolved";
      query: string;
      resolve: OntologyResolve;
      context: OntologyContext;
      view: LensView;
      /** The context URL that answered. */
      url: string;
    }
  | { status: "ambiguous"; query: string; resolve: OntologyResolve; context: null }
  | {
      status: "not_found";
      query: string;
      resolve: OntologyResolve;
      /** Set when the query resolved but the context route knows no object with that id. */
      context: OntologyNotFound | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A 404 from the context route that says no object has `id`. An API release
 * without the route answers through the object route instead, for the id
 * "<id>/context", which proves nothing about `id` itself.
 */
function unknownObject(body: unknown, id: string): OntologyNotFound | null {
  const answer = isRecord(body) && isRecord(body.detail) ? body.detail : body;
  if (!isRecord(answer) || answer.status !== "not_found") return null;
  return answer.id === undefined || answer.id === id ? (answer as unknown as OntologyNotFound) : null;
}

/**
 * Resolve a name, key or canonical id, then read where each product holds
 * data about it. Ambiguous and unknown queries are answers, not errors; an
 * API release without the context route is an error.
 */
export async function lookupContext(
  query: string,
  view: LensView = "summary",
  asOf: string | null = null,
): Promise<LensAnswer> {
  const dated = asOf ? `&as_of=${encodeURIComponent(asOf)}` : "";
  const resolve = await getJson<OntologyResolve>(`${ONTOLOGY}/resolve?q=${encodeURIComponent(query)}${dated}`);
  if (resolve?.status === "ambiguous") return { status: "ambiguous", query, resolve, context: null };
  if (resolve?.status === "not_found") return { status: "not_found", query, resolve, context: null };
  const id = resolve?.status === "resolved" ? resolve.id : undefined;
  if (typeof id !== "string" || !CANONICAL_ID.test(id)) {
    throw new Error(`unexpected resolve answer for "${query}"`);
  }
  const path = `${ONTOLOGY}/objects/${id}/context?view=${encodeURIComponent(view)}${dated}`;
  try {
    const context = await getJson<OntologyContext>(path);
    if (context?.status !== "resolved" || typeof context.id !== "string" || typeof context.label !== "string") {
      throw new Error(`unexpected context answer for ${id}`);
    }
    return { status: "resolved", query, resolve, context, view, url: `${apiBase}${path}` };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      const answer = unknownObject(err.body, id);
      if (answer) return { status: "not_found", query, resolve, context: answer };
      throw new Error(
        `"${query}" resolved to ${id}, but this API release does not serve the ontology context route (HTTP 404)`,
      );
    }
    throw err;
  }
}
