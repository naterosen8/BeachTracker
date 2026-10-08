// Vercel serverless function for beachgoer reports, stored in Upstash Redis (or Vercel KV).
//   GET  /api/reports?ids=osm:way/1,osm:node/2  -> { reports: { id: [report] }, history: { id: { slot: { sum, count } } } }
//   POST /api/reports { beachId, crowd: 1..5, parking?, note?, slot: "we:14" } -> { ok: true, report }
// Recent reports expire after a few hours; per-slot totals are kept so we can learn each beach's patterns.
// Without a store configured it answers 503, and the site falls back to saving reports on the device.

const KEEP_SECONDS = 6 * 60 * 60;
const MAX_RECENT = 50;
const MAX_IDS = 60;
const RATE_LIMIT_SECONDS = 10 * 60; // one report per beach per visitor every 10 minutes
const PARKING = ["plenty", "some", "full"];
const ID_RE = /^(osm:(node|way|relation)\/\d{1,15}|demo:[a-z0-9-]{1,40})$/;
const SLOT_RE = /^(we|wd):([01]?\d|2[0-3])$/;

function store() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  // Runs several Redis commands in one request; returns their results in order.
  return async (commands) => {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Store returned ${res.status}`);
    return (await res.json()).map((r) => {
      if (r.error) throw new Error(r.error);
      return r.result;
    });
  };
}

// Checks a submitted report; returns the cleaned report or throws with a message for the user.
function parseReport(body, now = Date.now()) {
  const b = body && typeof body === "object" ? body : {};
  if (typeof b.beachId !== "string" || !ID_RE.test(b.beachId)) throw new Error("Unknown beach");
  const crowd = Number(b.crowd);
  if (!Number.isInteger(crowd) || crowd < 1 || crowd > 5) throw new Error("Crowd must be 1 to 5");
  if (b.parking != null && !PARKING.includes(b.parking)) throw new Error("Unknown parking value");
  if (typeof b.slot !== "string" || !SLOT_RE.test(b.slot)) throw new Error("Missing time slot");
  const note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim().slice(0, 140) : "";
  const report = { time: now, crowd };
  if (b.parking) report.parking = b.parking;
  if (note) report.note = note;
  return { beachId: b.beachId, slot: b.slot, report };
}

// Turns HGETALL's flat [field, value, ...] list of "we:14:sum"/"we:14:n" into { "we:14": { sum, count } }.
function parseHistory(flat) {
  const history = {};
  for (let i = 0; i + 1 < (flat || []).length; i += 2) {
    const m = /^(.+):(sum|n)$/.exec(flat[i]);
    if (!m) continue;
    const slot = (history[m[1]] = history[m[1]] || { sum: 0, count: 0 });
    slot[m[2] === "sum" ? "sum" : "count"] = Number(flat[i + 1]) || 0;
  }
  return history;
}

function clientIp(req) {
  const fwd = (req.headers && req.headers["x-forwarded-for"]) || "";
  return fwd.split(",")[0].trim() || "unknown";
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return {};
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const run = store();
  if (!run) return res.status(503).json({ error: "not-configured" });

  try {
    if (req.method === "GET") {
      const ids = String((req.query && req.query.ids) || "").split(",").filter((id) => ID_RE.test(id)).slice(0, MAX_IDS);
      if (!ids.length) return res.status(200).json({ reports: {}, history: {} });
      const results = await run(ids.flatMap((id) => [
        ["LRANGE", `recent:${id}`, 0, MAX_RECENT - 1],
        ["HGETALL", `hist:${id}`],
      ]));
      const cutoff = Date.now() - KEEP_SECONDS * 1000;
      const reports = {};
      const history = {};
      ids.forEach((id, i) => {
        reports[id] = (results[2 * i] || []).map((s) => { try { return JSON.parse(s); } catch { return null; } })
          .filter((r) => r && r.time >= cutoff);
        history[id] = parseHistory(results[2 * i + 1]);
      });
      return res.status(200).json({ reports, history });
    }

    if (req.method === "POST") {
      let parsed;
      try {
        parsed = parseReport(await readBody(req));
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const { beachId, slot, report } = parsed;
      const [fresh] = await run([["SET", `rl:${clientIp(req)}:${beachId}`, "1", "NX", "EX", RATE_LIMIT_SECONDS]]);
      if (fresh !== "OK") return res.status(429).json({ error: "You reported this beach a few minutes ago. Thanks!" });
      await run([
        ["LPUSH", `recent:${beachId}`, JSON.stringify(report)],
        ["LTRIM", `recent:${beachId}`, 0, MAX_RECENT - 1],
        ["EXPIRE", `recent:${beachId}`, KEEP_SECONDS],
        ["HINCRBY", `hist:${beachId}`, `${slot}:sum`, report.crowd],
        ["HINCRBY", `hist:${beachId}`, `${slot}:n`, 1],
      ]);
      return res.status(200).json({ ok: true, report });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.warn(`reports: ${err.message}`);
    return res.status(502).json({ error: "Report store unavailable" });
  }
}

module.exports = handler;
module.exports.parseReport = parseReport;
module.exports.parseHistory = parseHistory;
