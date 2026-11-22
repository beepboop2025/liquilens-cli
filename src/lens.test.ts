import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Response } from "undici";
import {
  lookupContext,
  setApiBase,
  setFetch,
  type LensAnswer,
  type LensView,
  type OntologyContext,
  type OntologyNotFound,
  type OntologyResolve,
} from "./api.js";
import { renderLens, renderLensJson } from "./plain.js";

const IDBI = "inst:in/rbi/idbi-bank-limited";
const CONTEXT_PATH = `/api/experimental/v1/ontology/objects/${IDBI}/context`;

// Recorded from https://api.liquilens.in on 22 Nov 2026, before the context route shipped.
const RESOLVED: OntologyResolve = {
  schema: "liquilens.ontology-service.v1",
  status: "resolved",
  id: IDBI,
  rule: "unique_legal_name",
};
const AMBIGUOUS: OntologyResolve = {
  schema: "liquilens.ontology-service.v1",
  status: "ambiguous",
  candidates: ["place:in/geo/bihar-aurangabad", "place:in/geo/maharashtra-aurangabad"],
  reason: "known twice; use a canonical id or a key such as a CIN",
};
const NOT_FOUND: OntologyResolve = {
  schema: "liquilens.ontology-service.v1",
  status: "not_found",
  query: "zzzz",
  reason: "no registered object with this name or key; nothing is minted for an unknown name",
};
// An API release without the context route: the object route answers for "<id>/context".
const NOT_SERVED_404 = {
  detail: { schema: "liquilens.ontology-service.v1", status: "not_found", id: `${IDBI}/context` },
};
const UNKNOWN_404: { detail: OntologyNotFound } = {
  detail: { schema: "liquilens.ontology-context.v1", status: "not_found", id: IDBI },
};

// The example in the API's contract (docs/product/ONTOLOGY_AGENT_CONTEXT.md in LiquiLens), not a
// recording: the route was not live yet.
const CONTEXT: OntologyContext = {
  schema: "liquilens.ontology-context.v1",
  status: "resolved",
  id: IDBI,
  kind: "inst",
  label: "IDBI Bank Limited",
  jurisdiction: "IN",
  authority: "rbi",
  keys: {
    rbi_dbie_cohort_label: "IDBI BANK LIMITED",
    rbi_label: "IDBI Bank Limited",
    rbi_strbi_label: "IDBI BANK LIMITED",
  },
  links: {
    total: 1,
    by_kind: { supervised_by: 1 },
    sample: [
      {
        kind: "supervised_by",
        direction: "out",
        id: "source:in/self/reserve-bank-of-india",
        label: "Reserve Bank of India",
      },
    ],
  },
  events: [
    {
      id: "event:in/liquilens/idbi-bank-credit-event-2017-05-05",
      label: "IDBI Bank Limited: credit event in the LiquiLens failure record",
      date: "2017-05-05",
    },
  ],
  coverage: [
    {
      product: "LiquiLens",
      topic: "Cited human-review packet",
      mcp: {
        server: "https://api.liquilens.in/mcp",
        tool: "institution_review_packet",
        arguments: { institution: "idbi-bank" },
      },
      rest: `https://api.liquilens.in/api/experimental/v1/ontology/objects/${IDBI}/timeline`,
      site: "https://liquilens.in/banking/institutions/idbi-bank/",
    },
  ],
  view: null,
  boundary:
    "Identity and routing only. A coverage entry names a read that serves data about this object; it is " +
    "not evidence, freshness or a score, and the product that answers owns its answer.",
  access: { tier: "anonymous" },
};

interface Route {
  status: number;
  body: unknown;
}

function route(resolve: OntologyResolve, context: Route) {
  return (path: string): Route => {
    if (path === "/api/experimental/v1/ontology/resolve") return { status: 200, body: resolve };
    if (path.endsWith("/context")) return context;
    return { status: 404, body: { detail: "Not Found" } };
  };
}

/** Replace the network with `answer`; returns every path and query asked for. */
function stub(answer: (path: string) => Route): string[] {
  setApiBase("https://api.liquilens.in");
  const seen: string[] = [];
  setFetch(async (input) => {
    const url = new URL(String(input));
    seen.push(url.pathname + url.search);
    const { status, body } = answer(url.pathname);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return seen;
}

test("lens resolves, then reads the context with the view and date it was given", async () => {
  const seen = stub(route(RESOLVED, { status: 200, body: CONTEXT }));
  try {
    const answer = await lookupContext("IDBI Bank Ltd", "timeline", "2020-01-01");
    assert.equal(answer.status, "resolved");
    assert.deepEqual(answer.context, CONTEXT);
    assert.deepEqual(seen, [
      "/api/experimental/v1/ontology/resolve?q=IDBI%20Bank%20Ltd&as_of=2020-01-01",
      `${CONTEXT_PATH}?view=timeline&as_of=2020-01-01`,
    ]);
    if (answer.status === "resolved") {
      assert.equal(answer.url, `https://api.liquilens.in${CONTEXT_PATH}?view=timeline&as_of=2020-01-01`);
    }
  } finally {
    setFetch(null);
  }
});

test("ambiguous and unknown names are answers, and no context is asked for", async () => {
  try {
    for (const [resolve, status] of [
      [AMBIGUOUS, "ambiguous"],
      [NOT_FOUND, "not_found"],
    ] as const) {
      const seen = stub(route(resolve, { status: 200, body: CONTEXT }));
      const answer = await lookupContext("x");
      assert.equal(answer.status, status);
      assert.equal(answer.context, null);
      assert.equal(seen.length, 1);
    }
  } finally {
    setFetch(null);
  }
});

test("a context 404 for the resolved id is not_found, not an error", async () => {
  stub(route(RESOLVED, { status: 404, body: UNKNOWN_404 }));
  try {
    const answer = await lookupContext("IDBI Bank Ltd");
    assert.equal(answer.status, "not_found");
    assert.deepEqual(answer.context, UNKNOWN_404.detail);
    assert.match(renderLens(answer), new RegExp(`resolved to ${IDBI}, but the context route knows no object`));
  } finally {
    setFetch(null);
  }
});

test("an API release without the context route is an error that names the resolved id", async () => {
  try {
    for (const body of [NOT_SERVED_404, { detail: "Not Found" }]) {
      stub(route(RESOLVED, { status: 404, body }));
      await assert.rejects(lookupContext("IDBI Bank Ltd"), (err: Error) => {
        assert.match(err.message, new RegExp(`resolved to ${IDBI}`));
        assert.match(err.message, /does not serve the ontology context route \(HTTP 404\)/);
        return true;
      });
    }
  } finally {
    setFetch(null);
  }
});

test("HTTP errors reject: a 4xx at once, a 5xx after the retries", async () => {
  try {
    let seen = stub(route(RESOLVED, { status: 422, body: { detail: "view must be one of" } }));
    await assert.rejects(lookupContext("IDBI Bank Ltd"), /HTTP 422 from/);
    assert.equal(seen.length, 2);
    seen = stub(route(RESOLVED, { status: 503, body: {} }));
    await assert.rejects(lookupContext("IDBI Bank Ltd"), /HTTP 503 from/);
    assert.equal(seen.length, 4);
    seen = stub(() => ({ status: 429, body: {} }));
    await assert.rejects(lookupContext("IDBI Bank Ltd"), /HTTP 429 from \/api\/experimental\/v1\/ontology\/resolve/);
    assert.equal(seen.length, 3);
  } finally {
    setFetch(null);
  }
});

test("a resolved id that is not canonical is refused before any context request", async () => {
  const seen = stub(route({ status: "resolved", id: "../../admin" }, { status: 200, body: CONTEXT }));
  try {
    await assert.rejects(lookupContext("x"), /unexpected resolve answer/);
    assert.equal(seen.length, 1);
  } finally {
    setFetch(null);
  }
});

function resolvedAnswer(context: OntologyContext, view: LensView = "summary"): LensAnswer {
  return {
    status: "resolved",
    query: "IDBI Bank Ltd",
    resolve: RESOLVED,
    context,
    view,
    url: `https://api.liquilens.in${CONTEXT_PATH}?view=${view}`,
  };
}

test("the lens prints identity, keys, links, events and one block per coverage route", () => {
  const text = renderLens(resolvedAnswer(CONTEXT));
  const lines = text.split("\n");
  assert.equal(lines[0], "LIQUILENS · ONTOLOGY CONTEXT");
  assert.match(lines[1]!, /^Identity and routing only\./);
  for (const line of [
    "IDENTITY",
    "  IDBI Bank Limited",
    `  id: ${IDBI}`,
    "  kind: inst · jurisdiction: IN · authority: rbi",
    '  resolved from "IDBI Bank Ltd" by unique_legal_name',
    "  rbi_label: IDBI Bank Limited",
    "LINKS · 1 in all (supervised_by 1)",
    "  out supervised_by source:in/self/reserve-bank-of-india (Reserve Bank of India)",
    "  2017-05-05 event:in/liquilens/idbi-bank-credit-event-2017-05-05",
    "    IDBI Bank Limited: credit event in the LiquiLens failure record",
    "COVERAGE · most specific first",
    "  1. LiquiLens · Cited human-review packet",
    '     mcp: institution_review_packet {"institution":"idbi-bank"} on https://api.liquilens.in/mcp',
    "     site: https://liquilens.in/banking/institutions/idbi-bank/",
    `source: https://api.liquilens.in${CONTEXT_PATH}?view=summary`,
  ]) {
    assert.ok(lines.includes(line), `missing line: ${line}`);
  }
  assert.doesNotMatch(text, /withheld|trimmed|VIEW|undefined|\u2014|\u2013/);
});

test("withheld depth and trimmed rows are said up front; empty sections say so", () => {
  const text = renderLens(
    resolvedAnswer(
      {
        ...CONTEXT,
        events: [],
        coverage: [],
        view: { entries: [{ date: "2017-05-05" }] },
        trimmed: { "view.entries": 3 },
        access: {
          tier: "anonymous",
          withheld: [{ depth: "provenance", what: "source links", requires: "paid" }],
          how_to_get_access: "Free API keys: see https://liquilens.in.",
        },
      },
      "timeline",
    ),
  );
  const lines = text.split("\n");
  const identity = lines.indexOf("IDENTITY");
  const withheld = lines.indexOf("withheld for this caller: provenance (source links; needs a paid key)");
  const trimmed = lines.indexOf("trimmed to fit the response budget: view.entries 3");
  assert.ok(withheld > 0 && withheld < identity, text);
  assert.ok(trimmed > 0 && trimmed < identity, text);
  assert.ok(lines.includes("Free API keys: see https://liquilens.in."));
  assert.ok(lines.includes("  no event object concerns this object"));
  assert.ok(lines.some((line) => line.startsWith("  no product read is routed for this object")));
  assert.ok(lines.includes("VIEW · timeline"));
  assert.match(text, /"date": "2017-05-05"/);
});

test("ambiguous and unknown answers print the candidates or say nothing is guessed", () => {
  const ambiguous = renderLens({ status: "ambiguous", query: "Aurangabad", resolve: AMBIGUOUS, context: null });
  assert.match(ambiguous, /"Aurangabad" names more than one object, and none is picked\./);
  assert.match(ambiguous, /\n {2}place:in\/geo\/bihar-aurangabad\n {2}place:in\/geo\/maharashtra-aurangabad\n/);
  const unknown = renderLens({ status: "not_found", query: "zzzz", resolve: NOT_FOUND, context: null });
  assert.match(unknown, /"zzzz": not found\. No object carries that name or key, and nothing is guessed or minted\./);
});

test("--json preserves the served payload: the context, else the resolve answer", () => {
  assert.deepEqual(JSON.parse(renderLensJson(resolvedAnswer(CONTEXT))), CONTEXT);
  const ambiguous: LensAnswer = { status: "ambiguous", query: "Aurangabad", resolve: AMBIGUOUS, context: null };
  assert.deepEqual(JSON.parse(renderLensJson(ambiguous)), AMBIGUOUS);
  const unknown: LensAnswer = {
    status: "not_found",
    query: "IDBI Bank Ltd",
    resolve: RESOLVED,
    context: UNKNOWN_404.detail,
  };
  assert.deepEqual(JSON.parse(renderLensJson(unknown)), UNKNOWN_404.detail);
});

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

test("lens refuses bad usage before networking", () => {
  for (const [args, message] of [
    [["lens", "   "], /lens needs a name, key or id/],
    [["lens", "IDBI", "Bank"], /lens takes one query; quote a name with spaces/],
    [["lens", "x", "--view", "everything"], /--view must be one of summary, relationships/],
    [["lens", "x", "--as-of", "2026-02-30"], /--as-of must be a date written YYYY-MM-DD/],
    [["lens", "x", "--region", "us"], /lens cannot be combined/],
    [["--view", "timeline"], /--view and --as-of work with lens only/],
  ] as const) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(run.status, 2, `${args.join(" ")}: ${run.stderr}`);
    assert.match(run.stderr, message);
  }
});

/** Serve fixed answers on a loopback port, run the real CLI against it, and stop. */
async function runAgainst(
  answer: (path: string) => Route,
  args: string[],
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const server = createServer((req, res) => {
    const { status, body } = answer(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    res.writeHead(status, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const env = { ...process.env };
  for (const name of ["LIQUILENS_API", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) delete env[name];
  try {
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, ...args, "--api", `http://127.0.0.1:${port}`], { env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("the command exits 0 with the lens, and 1 when the API release has no context route", async () => {
  const ok = await runAgainst(route(RESOLVED, { status: 200, body: CONTEXT }), ["lens", "IDBI Bank Ltd"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^LIQUILENS · ONTOLOGY CONTEXT\n/);
  assert.match(ok.stdout, /\n {2}1\. LiquiLens · Cited human-review packet\n/);
  const json = await runAgainst(route(AMBIGUOUS, { status: 200, body: CONTEXT }), ["lens", "Aurangabad", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), AMBIGUOUS);
  const missing = await runAgainst(route(RESOLVED, { status: 404, body: NOT_SERVED_404 }), ["lens", "IDBI Bank Ltd"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /could not read the ontology context from http:\/\/127\.0\.0\.1:\d+/);
  assert.match(missing.stderr, /does not serve the ontology context route/);
});
