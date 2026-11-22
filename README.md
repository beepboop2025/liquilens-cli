# liquilens: the terminal

The LiquiLens Failure Radar as a live terminal dashboard, in the spirit of
Claude Code / htop. Zero keys required: it reads the same public, no-auth
endpoints that power the web board, and keeps working offline from a cached
snapshot.

Need the radar on your own counterparty or borrower book? A fixed-scope,
self-hosted proof pilot is available at
[liquilens.in/pilot](https://liquilens.in/pilot/).

The same command also answers `liquilens lens <name, key or id>`: where
each product in the family (LiquiLens, Seiche, Undertow, Palimpsest) holds
data about one institution, place, instrument or event. See
[The ontology lens](#the-ontology-lens).

Layout of the India board while review tiers are paused (values elided):

```
◆ LIQUILENS · Failure Radar · IN/US (t to switch)
market regime ... (log-SR ..., last change ...) · <regime date>
review tiers paused since 2026-11-03: tiers paused, research only; no grade, band or colour is shown and PDs are research only

  INSTITUTION                     TYPE  SCORE PD 12M* Δ PD      FUNDING
❯ ...
```

Two boards, one command:

- **IN** covers Indian banks, SFBs, NBFCs and MFIs. The public summary shows
  the score, 12/24/36-month research probabilities, funding index and RBI zone.
  Detail depends on what the API serves. Grades require published review
  tiers. Risk bands also require the underlying inputs.
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
liquilens lens "IDBI Bank Ltd"   # where each product holds data about it
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
- **`lens <query>`**: one-shot ontology lens for one name, key or id; see
  [The ontology lens](#the-ontology-lens). `--json` prints the payload the
  API served, unchanged.
- **`--fail-on amber|red`**: alerting for cron/CI. Exits 3 when any Indian
  institution is at/above the band, 0 when all are below it, and 4 when the
  tiers are paused or the board lacks the detailed inputs for a comparison.
  On the US board, scores are within-quarter percentile ranks,
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

## The ontology lens

```bash
liquilens lens "IDBI Bank Ltd"                   # a name
liquilens lens "$CIN"                            # any key: a CIN, LEI, ISIN, CUSIP or slug
liquilens lens inst:in/rbi/idbi-bank-limited --view timeline   # a canonical id
liquilens lens "IDBI Bank Ltd" --as-of 2020-01-01 --json
```

`lens` resolves the query on the LiquiLens ontology, then reads that
object's context: its identity, public keys, a sample of its links, the
events that concern it, and one coverage entry for every product read that
serves data about it, the most specific first, each with its MCP tool and
exact arguments, its REST URL or its site page. `--view` adds one bounded
read model (`relationships`, `timeline`, `provenance` or `neighbourhood`);
`--as-of` reads the name and the view on that date.

Layout (values elided):

```
LIQUILENS · ONTOLOGY CONTEXT
Identity and routing only. A coverage entry names a read that serves data about this object; ...

IDENTITY
  <label>
  id: inst:in/rbi/<name>
  kind: inst · jurisdiction: IN · authority: rbi
  resolved from "<query>" by <rule>

KEYS
  <key space>: <key>

LINKS · <n> in all (<link kind> <n>)
  out supervised_by source:in/self/reserve-bank-of-india (Reserve Bank of India)

EVENTS
  <date> event:in/...
    <event label>

COVERAGE · most specific first
  1. <product> · <topic>
     mcp: <tool> {<exact arguments>} on <MCP server>
     rest: <URL>
     site: <URL>

source: https://api.liquilens.in/api/experimental/v1/ontology/objects/<id>/context?view=summary
```

The lens is identity and routing, never evidence: a coverage entry says
that a product serves data about the object and how to ask for it, not
what the data says, how fresh it is, or any score, and the product that
answers owns its answer. An ambiguous name prints its candidate ids and
picks none; an unknown name says nothing was guessed. When the API trims
an answer to fit its size budget or withholds depth from a keyless caller,
the lens says so at the top, before any section, so a partial answer never
reads as a complete one. No coverage entry means no product read is routed
for the object, which says nothing about the object itself.

`lens` is never cached: a lookup the API cannot answer exits 1. It exits 0
for every answer, including ambiguous and unknown names; with `--json`,
check `status` (`resolved`, `ambiguous` or `not_found`). The JSON is the
context (`liquilens.ontology-context.v1`) when the query resolved, else the
resolve answer (`liquilens.ontology-service.v1`).

**Status (22 Nov 2026):** works once the LiquiLens API release that serves
the context route (`/api/experimental/v1/ontology/objects/{id}/context`)
is live; the resolve step is live today. Until then `lens` resolves the
query, then exits 1 saying the API release does not serve the context
route.

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
  bands, review-tier pause, sparkline, US formatting, cache) and the ontology
  lens (with fetch stubbed, plus the real command against a loopback stub
  API) are unit-tested (`npm test`);
  CI runs build + tests + live smokes on Node
  18/20/22.

## Privacy

The CLI sends no cookies, device identifiers, installation IDs, or command
analytics. API requests carry the aggregate product-surface label `cli` so the
service can count successful board reads. Arguments, filters, cache contents,
and machine details are never sent as analytics. `lens` sends the name, key
or id you look up to the API, because that text is the lookup itself; the CLI
keeps no copy.

## Exit codes

0 ok · 1 no data (API down, no cache) · 2 bad usage · 3 `--fail-on` breached ·
4 `--fail-on` could not evaluate the board (tiers paused or detailed inputs unavailable)

`lens`: 0 answered (resolved, ambiguous or not found) · 1 the API could not
answer (unreachable, an HTTP error, or an API release without the context
route) · 2 bad usage

## Config

- `--api <url>` or `LIQUILENS_API`: API host (default
  `https://api.liquilens.in`), e.g. a local backend on `:8000`.
- `HTTPS_PROXY`: standard CONNECT proxy, honored by all requests.

## Where things live

- `src/api.ts`: typed fetchers, retry/backoff, proxy + Happy-Eyeballs dialing,
  and `lookupContext` for the ontology lens.
- `src/cache.ts`: per-region last-good-snapshot cache.
- `src/format.ts`: pure layout/sort/filter/viewport/sparkline logic (tested).
- `src/riskBands.ts`: the row-colour policies and the review-tier pause
  check. India = absolute thresholds (domain judgment, tune here). US = rank-within-board (percentile scores
  drift across quarters, ranks don't).
- `src/plain.ts`: `--plain` / `--json` renderers + `--fail-on` band logic, and
  the lens renderers (`renderLens`, `renderLensJson`).
- `src/App.tsx`: the Ink UI. `src/cli.tsx`: entry point + arg parsing.
