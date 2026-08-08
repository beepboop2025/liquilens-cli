# liquilens — the terminal

The LiquiLens Failure Radar as a live terminal dashboard, in the spirit of
Claude Code / htop. Zero keys required: it reads the same public, no-auth
endpoints that power the web board, and keeps working offline from a cached
snapshot.

Need the radar on your own counterparty or borrower book? A fixed-scope,
self-hosted proof pilot is available at
[liquilens.in/pilot](https://liquilens.in/pilot/).

```
◆ LIQUILENS · Failure Radar · IN/US (t to switch)
market regime SHIFT (log-SR 1.16, last change 13d ago) ███▁▁▂▂▂ · 2026-07-16

  INSTITUTION                     TYPE  GRADE SCORE PD 12M  Δ PD      FUNDING
❯ ESAF Small Finance Bank         sfb   BBB   66    0.40%   ▲ 0.09%   stable
  ...
```

Two boards, one command:

- **IN** — Indian institutions (banks/SFBs/NBFCs/MFIs): grades, 12/24/36-month
  failure probabilities, funding bands, PCA status, forensics, market lens,
  GDELT news watch.
- **US** — the riskiest tail of 1,000+ FDIC-scored banks (undertow engine):
  within-quarter percentile score, noncurrent assets, uninsured/brokered
  deposits, CRE concentration, NDFI-to-tier-1.

## Install

Run once without keeping an install:

```bash
npx liquilens
```

Or keep the command on your PATH:

```bash
npm install --global liquilens
liquilens               # India board
liquilens --region us   # US board
liquilens --record      # evidence status and eligibility, all markets
```

From a source checkout:

```bash
npm ci
npm link
liquilens
```

## Modes

- **Interactive TUI** (default in a terminal): live board, auto-refreshes
  every 5 minutes, adapts to any terminal size (scrolling viewport on short
  terminals, adaptive columns on narrow ones), `t` switches region.
- **`--plain`** (automatic when piped): one-shot ANSI-free table — safe for
  scripts, cron mails, CI logs.
- **`--json`**: one-shot machine-readable dump (rows + `risk_band` + regime).
- **`--record`**: one-shot historical-evidence ledger for India, the US, and
  Europe. It prints each market's construction/case-file status plus
  `validated_backtest_eligible` and `real_money_eligible`; add `--json` to
  preserve the served `/api/evidence/markets` payload exactly. It cannot be
  combined with `--region` or `--fail-on`.
- **`--fail-on amber|red`**: alerting for cron/CI — exits 3 when any Indian
  institution is at/above the band. (India only: US scores are within-quarter
  percentile ranks — a relative leaderboard — so an absolute threshold would
  always fire.)

```bash
# cron: mail me the board only when something turns red
liquilens --fail-on red > /tmp/board.txt || mail -s "LiquiLens RED" me@x < /tmp/board.txt

# audit the historical-evidence boundary without opening the web app
liquilens --record
liquilens --record --json | jq '.markets[] | {name, historical_evidence}'
```

## Keys

| key | action |
| --- | --- |
| ↑/↓ or j/k | move selection |
| ⏎ | toggle institution detail |
| t | switch region (IN ↔ US) |
| s | cycle sort (IN: risk/movement/score/name · US: risk/noncurrent/uninsured/assets/name) |
| / | incremental filter (IN: name/slug/type · US: bank/state/FDIC cert) |
| r | refresh now |
| esc | close detail / clear filter |
| q | quit |

## Reliability

- **Retries**: 3 attempts with backoff on network errors, 429s and 5xx.
- **Offline cache**: every good board is snapshotted per region (atomic write,
  XDG cache dir; `%LOCALAPPDATA%` on Windows). If the API is unreachable you
  get the cached board with a clear "offline — cached from Xh ago" banner.
  Exit 1 only when there is no data at all.
- **Networks**: IPv4-first DNS plus undici `autoSelectFamily` (fast Happy
  Eyeballs) — works on IPv6-blackholed *and* IPv6-only networks. `HTTPS_PROXY`
  / `HTTP_PROXY` / `NO_PROXY` are honored.
- **Partial failure**: if only the market-regime endpoint fails, the board
  still renders with a "regime unavailable" note.
- **Tests + CI**: pure logic (columns, sorting, filtering, viewport, risk
  bands, sparkline, US formatting, cache) is unit-tested (`npm test`);
  CI runs build + tests + live smokes on Node
  18/20/22.

## Privacy

The CLI sends no cookies, device identifiers, installation IDs, or command
analytics. API requests carry the aggregate product-surface label `cli` so the
service can count successful board reads. Arguments, filters, cache contents,
and machine details are never sent as analytics.

## Exit codes

0 ok · 1 no data (API down, no cache) · 2 bad usage · 3 `--fail-on` breached

## Config

- `--api <url>` or `LIQUILENS_API` — API host (default
  `https://api.liquilens.in`), e.g. a local backend on `:8000`.
- `HTTPS_PROXY` — standard CONNECT proxy, honored by all requests.

## Where things live

- `src/api.ts` — typed fetchers, retry/backoff, proxy + Happy-Eyeballs dialing.
- `src/cache.ts` — per-region last-good-snapshot cache.
- `src/format.ts` — pure layout/sort/filter/viewport/sparkline logic (tested).
- `src/riskBands.ts` — the row-colour policies. India = absolute thresholds
  (domain judgment — tune here). US = rank-within-board (percentile scores
  drift across quarters, ranks don't).
- `src/plain.ts` — `--plain` / `--json` renderers + `--fail-on` band logic.
- `src/App.tsx` — the Ink UI. `src/cli.tsx` — entry point + arg parsing.
