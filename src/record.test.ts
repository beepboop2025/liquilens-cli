import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { EvidenceMarketsResponse } from "./api.js";
import { renderEvidenceJson, renderEvidenceRecord } from "./plain.js";

const fixture: EvidenceMarketsResponse = {
  markets: [
    {
      key: "india",
      name: "India",
      kind: "filing-availability-proxied construction-PIT diagnostic",
      headline: "48 institutions; misses included",
      institutions: 48,
      historical_evidence: {
        status: "PERIOD_END_PROXY_CONSTRUCTION_PIT",
        validated_backtest_eligible: false,
        real_money_eligible: false,
        filing_lag_days: 60,
      },
    },
    {
      key: "europe",
      name: "Europe",
      kind: "named case files (no cohort claim)",
      headline: "7 named institutions",
      institutions: 7,
      historical_evidence: {
        status: "NAMED_CASE_FILES_CONSTRUCTION_PIT",
        validated_backtest_eligible: false,
        real_money_eligible: false,
      },
    },
  ],
};

test("record plain output carries status and both eligibility flags", () => {
  const output = renderEvidenceRecord(fixture);
  assert.match(output, /HISTORICAL EVIDENCE STATUS/);
  assert.match(output, /PERIOD_END_PROXY_CONSTRUCTION_PIT/);
  assert.equal((output.match(/validated-backtest eligible: NO/g) ?? []).length, 2);
  assert.equal((output.match(/real-money eligible: NO/g) ?? []).length, 2);
  assert.match(output, /api\.liquilens\.in\/api\/evidence\/markets/);
});

test("record JSON preserves the served payload", () => {
  assert.deepEqual(JSON.parse(renderEvidenceJson(fixture)), fixture);
});

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

test("record refuses region and alert-band combinations before networking", () => {
  for (const args of [
    ["--record", "--region", "us"],
    ["--record", "--fail-on", "red"],
  ]) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(run.status, 2, `${args.join(" ")}: ${run.stderr}`);
    assert.match(run.stderr, /--record cannot be combined/);
  }
});

