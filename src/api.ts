import {
  fetch as undiciFetch,
  Agent,
  EnvHttpProxyAgent,
  type Dispatcher,
} from "undici";

export const DEFAULT_API = "https://api.liquilens.in";

let apiBase = process.env.LIQUILENS_API ?? DEFAULT_API;

export function setApiBase(url: string): void {
  apiBase = url.replace(/\/+$/, "");
}

export function getApiBase(): string {
  return apiBase;
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

export interface BoardRow {
  slug: string;
  name: string;
  inst_type: string;
  label: string;
  as_of: string;
  quarter: string;
  age_months: number;
  score: number;
  grade: string;
  hazard: {
    pd_12m: number;
    pd_24m: number;
    pd_36m: number;
    grade: string;
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

export interface Board {
  as_of: string;
  rows: BoardRow[];
  method_note?: string;
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

export interface NewsSignal {
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

const RETRIES = 3;
const ATTEMPT_TIMEOUT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJson<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await undiciFetch(`${apiBase}${path}`, {
        dispatcher,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        headers: { "user-agent": "liquilens-cli" },
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${path}`);
      } else if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${path}`);
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
