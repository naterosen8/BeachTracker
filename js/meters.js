// Live street-meter occupancy from the City of Los Angeles (LADOT open data), for beaches in LA.
// Only meters with occupancy sensors report, and only on-street meters, not beach lots, so the
// site labels this exactly as "street meters". Sensors that haven't reported for a day are ignored,
// since a silent sensor may be broken.

const LADOT = "https://data.lacity.org/resource";
const METER_INVENTORY = `${LADOT}/s49e-q6j2.json`; // every meter, with location
const METER_OCCUPANCY = `${LADOT}/e7h6-4a3e.json`; // latest state of sensor-equipped meters
const METER_WALK_M = 800; // straight line, about half a mile (the card says so)
const METER_STALE_MS = 24 * 60 * 60 * 1000;
const METER_MIN_SENSORS = 3; // fewer than this says too little about the street
const METER_MAX_BEACHES = 20;
// A box around the City of Los Angeles; beaches outside it have no LADOT meters.
const LA_BOX = { south: 33.7, north: 34.34, west: -118.67, east: -118.15 };

const inLosAngeles = (b) => b.lat >= LA_BOX.south && b.lat <= LA_BOX.north && b.lon >= LA_BOX.west && b.lon <= LA_BOX.east;

const soql = (s) => encodeURIComponent(s).replace(/'/g, "%27");

// Returns { beachId: { free, total, newest } } for beaches with sensor-equipped meters nearby.
async function getMeters(beaches, fetchJson = getJson) {
  const nearLA = beaches.filter(inLosAngeles).slice(0, METER_MAX_BEACHES);
  if (!nearLA.length) return {};
  const circles = nearLA
    .map((b) => `within_circle(latlng, ${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}, ${METER_WALK_M})`)
    .join(" OR ");
  const inventory = await fetchJson(`${METER_INVENTORY}?$select=spaceid,latlng&$limit=5000&$where=${soql(circles)}`);
  if (!inventory.length) return {};
  const ids = inventory.slice(0, 600).map((m) => `'${String(m.spaceid).replace(/'/g, "''")}'`).join(",");
  const occupancy = await fetchJson(`${METER_OCCUPANCY}?$limit=5000&$where=${soql(`spaceid in(${ids})`)}`);
  return summarizeMeters(nearLA, inventory, occupancy);
}

function summarizeMeters(beaches, inventory, occupancy, now = Date.now()) {
  const where = new Map();
  for (const m of inventory) {
    if (!m.latlng) continue;
    where.set(m.spaceid, { lat: Number(m.latlng.latitude), lon: Number(m.latlng.longitude) });
  }
  const live = [];
  for (const o of occupancy) {
    const at = where.get(o.spaceid);
    // LADOT event times are UTC without a zone suffix.
    const time = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(o.eventtime) ? o.eventtime : `${o.eventtime}Z`);
    if (!at || !Number.isFinite(time) || now - time > METER_STALE_MS) continue;
    if (o.occupancystate !== "VACANT" && o.occupancystate !== "OCCUPIED") continue;
    live.push({ ...at, time, free: o.occupancystate === "VACANT" });
  }
  const result = {};
  for (const b of beaches) {
    const near = live.filter((m) => distanceKm(b, m) * 1000 <= METER_WALK_M);
    if (near.length < METER_MIN_SENSORS) continue;
    result[b.id] = {
      free: near.filter((m) => m.free).length,
      total: near.length,
      newest: Math.max(...near.map((m) => m.time)),
    };
  }
  return result;
}

if (typeof module !== "undefined") {
  module.exports = { getMeters, summarizeMeters, inLosAngeles };
}
