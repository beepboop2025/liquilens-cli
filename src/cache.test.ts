import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the cache at a temp dir BEFORE importing the module under test.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liquilens-test-"));
process.env.XDG_CACHE_HOME = tmp;

const { saveCached, loadCached, ageMinutes, describeAge } = await import(
  "./cache.js"
);

test("round-trips a snapshot per region", () => {
  saveCached("in", { board: { as_of: "2026-07-16" } });
  saveCached("us", { as_of: "2026-03-31" });
  const inSnap = loadCached<{ board: { as_of: string } }>("in");
  const usSnap = loadCached<{ as_of: string }>("us");
  assert.equal(inSnap?.data.board.as_of, "2026-07-16");
  assert.equal(usSnap?.data.as_of, "2026-03-31");
  assert.ok(Date.parse(inSnap!.savedAt) > 0);
});

test("regions are cached independently", () => {
  const file = path.join(tmp, "liquilens", "last-in.json");
  fs.rmSync(file);
  assert.equal(loadCached("in"), null);
  assert.ok(loadCached("us"), "us cache must survive in-cache removal");
});

test("loadCached returns null for corrupt cache", () => {
  const file = path.join(tmp, "liquilens", "last-in.json");
  fs.writeFileSync(file, "{not json");
  assert.equal(loadCached("in"), null);
  fs.writeFileSync(file, JSON.stringify({ savedAt: "2026-01-01" }));
  assert.equal(loadCached("in"), null, "missing data field -> null");
});

test("ageMinutes and describeAge", () => {
  const now = Date.parse("2026-07-16T12:00:00Z");
  assert.equal(ageMinutes("2026-07-16T11:30:00Z", now), 30);
  assert.equal(describeAge(0), "just now");
  assert.equal(describeAge(30), "30m ago");
  assert.equal(describeAge(120), "2h ago");
  assert.equal(describeAge(3 * 24 * 60), "3d ago");
  assert.equal(describeAge(Infinity), "unknown age");
  assert.equal(ageMinutes("garbage", now), Infinity);
});
