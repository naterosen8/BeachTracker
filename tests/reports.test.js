const test = require("node:test");
const assert = require("node:assert");
const handler = require("../api/reports.js");
const { parseReport, parseHistory } = handler;

function fakeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

// Stands in for Upstash: records each pipeline and answers with canned results.
function fakeStore(t, answer) {
  process.env.UPSTASH_REDIS_REST_URL = "https://store.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  t.after(() => { delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    const commands = JSON.parse(opts.body);
    calls.push(commands);
    return { ok: true, json: async () => commands.map((c) => ({ result: answer(c) })) };
  });
  return calls;
}

test("parseReport accepts a good report and trims the note", () => {
  const r = parseReport({ beachId: "osm:way/123", crowd: 4, parking: "some", note: "  lot   full ", slot: "we:14" }, 1000);
  assert.deepStrictEqual(r, { beachId: "osm:way/123", slot: "we:14", report: { time: 1000, crowd: 4, parking: "some", note: "lot full" } });
});

test("parseReport rejects bad input", () => {
  const ok = { beachId: "osm:node/1", crowd: 3, slot: "wd:9" };
  assert.throws(() => parseReport({ ...ok, beachId: "recent:x" }), /Unknown beach/);
  assert.throws(() => parseReport({ ...ok, crowd: 6 }), /1 to 5/);
  assert.throws(() => parseReport({ ...ok, crowd: 2.5 }), /1 to 5/);
  assert.throws(() => parseReport({ ...ok, parking: "lots" }), /parking/);
  assert.throws(() => parseReport({ ...ok, slot: "we:24" }), /slot/);
  assert.throws(() => parseReport(null), /Unknown beach/);
});

test("parseHistory groups sums and counts by slot", () => {
  assert.deepStrictEqual(parseHistory(["we:14:sum", "20", "we:14:n", "5", "wd:9:n", "2"]), {
    "we:14": { sum: 20, count: 5 },
    "wd:9": { sum: 0, count: 2 },
  });
  assert.deepStrictEqual(parseHistory(null), {});
});

test("without a store the API says it isn't configured", async () => {
  const res = fakeRes();
  await handler({ method: "GET", query: { ids: "osm:way/1" } }, res);
  assert.strictEqual(res.statusCode, 503);
});

test("GET returns recent reports and history", async (t) => {
  const now = Date.now();
  fakeStore(t, (c) => (c[0] === "LRANGE"
    ? [JSON.stringify({ time: now, crowd: 3 }), JSON.stringify({ time: now - 7 * 3600e3, crowd: 5 }), "junk"]
    : ["we:14:sum", "8", "we:14:n", "2"]));
  const res = fakeRes();
  await handler({ method: "GET", query: { ids: "osm:way/1,bad id" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body.reports, { "osm:way/1": [{ time: now, crowd: 3 }] });
  assert.deepStrictEqual(res.body.history, { "osm:way/1": { "we:14": { sum: 8, count: 2 } } });
});

test("POST stores the report and updates history", async (t) => {
  const calls = fakeStore(t, (c) => (c[0] === "SET" ? "OK" : 1));
  const res = fakeRes();
  await handler({
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4" },
    body: { beachId: "osm:way/1", crowd: 5, parking: "full", slot: "we:14" },
  }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(calls[0][0], ["SET", "rl:1.2.3.4:osm:way/1", "1", "NX", "EX", 600]);
  const names = calls[1].map((c) => c[0]);
  assert.deepStrictEqual(names, ["LPUSH", "LTRIM", "EXPIRE", "HINCRBY", "HINCRBY"]);
  assert.deepStrictEqual(calls[1][3], ["HINCRBY", "hist:osm:way/1", "we:14:sum", 5]);
});

test("POST is rate limited per visitor and beach", async (t) => {
  const calls = fakeStore(t, () => null); // SET NX fails: already reported
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { beachId: "osm:way/1", crowd: 2, slot: "wd:9" } }, res);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(calls.length, 1);
});

test("POST rejects invalid reports before touching the store", async (t) => {
  const calls = fakeStore(t, () => "OK");
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: JSON.stringify({ beachId: "osm:way/1", crowd: 0, slot: "wd:9" }) }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(calls.length, 0);
});
