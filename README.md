# liquilens: the terminal

The LiquiLens Failure Radar as a live terminal dashboard, in the spirit of
Claude Code / htop. Zero keys required: it reads the same public, no-auth
endpoints that power the web board, and keeps working offline from a cached
snapshot.

Need the radar on your own counterparty or borrower book? A fixed-scope,
self-hosted proof pilot is available at
[liquilens.in/pilot](https://liquilens.in/pilot/).

Layout of the India board while review tiers are paused (values elided):

```
◆ LIQUILENS · Failure Radar · IN/US (t to switch)
market regime ... (log-SR ..., last change ...) · <regime date>
review tiers paused since 2026-11-03: tiers paused, research only; no grade, band or colour is shown and PDs are research only

  INSTITUTION                     TYPE  SCORE PD 12M* Δ PD      FUNDING
❯ ...
```

Two boards, one command:

- **IN** (Indian banks, SFBs, NBFCs and MFIs): score, 12/24/36-month
  failure probabilities, funding bands, PCA status, forensics, market lens,
  GDELT news watch. Grades and row colours appear only while the API
  publishes India review tiers; see "While India review tiers are paused".
- **US** (the riskiest tail of 1,000+ FDIC-scored banks, undertow engine):
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
- **`--plain`** (automatic when piped): one-shot ANSI-free table, safe for
  scripts, cron mails, CI logs.
- **`--json`**: one-shot machine-readable dump of rows, regime and
  `tier_publication`. India rows carry `risk_band` only while review tiers
  are published; US rows always carry their rank band.
- **`--record`**: one-shot historical-evidence ledger for India, the US, and
  Europe. It prints each market's construction/case-file status plus
  `validated_backtest_eligible` and `real_money_eligible`; add `--json` to
  preserve the served `/api/evidence/markets` payload exactly. It cannot be
  combined with `--region` or `--fail-on`.
- **`--fail-on amber|red`**: alerting for cron/CI. Exits 3 when any Indian
  institution is at/above the band, 0 when none is, and 4 when the API has
  paused India review tiers (there is no band to compare, so the check is
  not evaluated). India only: US scores are within-quarter percentile ranks,
  a relative leaderboard, so an absolute threshold would always fire.

```bash
# cron: mail me the board when something turns red, and say so when the
# check could not run (4 = review tiers paused, 1 = no data)
liquilens --fail-on red > /tmp/board.txt
case $? in
  0) ;;
  3) mail -s "LiquiLens RED" me@x < /tmp/board.txt ;;
  *) mail -s "LiquiLens check not evaluated" me@x < /tmp/board.txt ;;
esac

# audit the historical-evidence boundary without opening the web app
liquilens --record
liquilens --record --json | jq '.markets[] | {name, historical_evidence}'
```

## While India review tiers are paused

Since 2026-11-03 the API has paused India review tiers. The reason, in the
API's own words, is in the `tier_publication` object it serves. While the
pause holds:

- the board shows no grade, band or row colour, and the PD columns are
  marked research only;
- `--json` rows carry no `risk_band`, and the top-level `tier_publication`
  object states the pause;
- `--fail-on` exits 4 ("not evaluated") rather than 0 or 3. A paused board
  is not a calm board, so the CLI never reports a pass it could not check.

The CLI reads this from `tier_publication.state` alone. Anything other than
`published`, including a missing field or an older cached board, is treated
as paused.

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
  get the cached board under an offline banner that states its age.
  Exit 1 only when there is no data at all.
- **Networks**: IPv4-first DNS plus undici `autoSelectFamily` (fast Happy
  Eyeballs), so it works on IPv6-blackholed *and* IPv6-only networks. `HTTPS_PROXY`
  / `HTTP_PROXY` / `NO_PROXY` are honored.
- **Partial failure**: if only the market-regime endpoint fails, the board
  still renders with a "regime unavailable" note.
- **Tests + CI**: pure logic (columns, sorting, filtering, viewport, risk
  bands, review-tier pause, sparkline, US formatting, cache) is unit-tested (`npm test`);
  CI runs build + tests + live smokes on Node
  18/20/22.

## Privacy

The CLI sends no cookies, device identifiers, installation IDs, or command
analytics. API requests carry the aggregate product-surface label `cli` so the
service can count successful board reads. Arguments, filters, cache contents,
and machine details are never sent as analytics.

## Exit codes

0 ok · 1 no data (API down, no cache) · 2 bad usage · 3 `--fail-on` breached ·
4 `--fail-on` not evaluated (India review tiers paused)

## Config

- `--api <url>` or `LIQUILENS_API`: API host (default
  `https://api.liquilens.in`), e.g. a local backend on `:8000`.
- `HTTPS_PROXY`: standard CONNECT proxy, honored by all requests.

## Where things live

- `src/api.ts`: typed fetchers, retry/backoff, proxy + Happy-Eyeballs dialing.
- `src/cache.ts`: per-region last-good-snapshot cache.
- `src/format.ts`: pure layout/sort/filter/viewport/sparkline logic (tested).
- `src/riskBands.ts`: the row-colour policies and the review-tier pause
  check. India = absolute thresholds (domain judgment, tune here). US = rank-within-board (percentile scores
  drift across quarters, ranks don't).
- `src/plain.ts`: `--plain` / `--json` renderers + `--fail-on` band logic.
- `src/App.tsx`: the Ink UI. `src/cli.tsx`: entry point + arg parsing.
