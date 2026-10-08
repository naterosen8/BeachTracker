// Loads beaches and parking (OpenStreetMap), weather (Open-Meteo), place search (Nominatim),
// and beachgoer reports (our /api/reports, or this device's storage when that isn't set up).

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const PARKING_NEAR_KM = 0.6;
const LOCAL_KEY = "beachcheck.reports";

async function getJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return res.json();
}

// Named beaches within radiusKm of { lat, lon }, with a count of parking lots near each.
async function findBeaches(center, radiusKm = 25) {
  const r = Math.round(radiusKm * 1000);
  const query = `[out:json][timeout:25];
(nwr["natural"="beach"]["name"](around:${r},${center.lat},${center.lon}););out center tags 80;
(nwr["amenity"="parking"](around:${r + 1000},${center.lat},${center.lon}););out center 1500;`;
  let json;
  const failures = [];
  for (const url of OVERPASS_URLS) {
    try {
      json = await getJson(url, { method: "POST", body: new URLSearchParams({ data: query }) });
      break;
    } catch (err) {
      failures.push(err.message);
    }
  }
  if (!json) throw new Error(`Couldn't load beaches (${failures.join("; ")})`);
  return parseOverpass(json, center);
}

function parseOverpass(json, center) {
  const point = (e) => (e.center ? { lat: e.center.lat, lon: e.center.lon } : { lat: e.lat, lon: e.lon });
  const parking = [];
  const beaches = [];
  const seen = new Set();
  for (const e of json.elements || []) {
    const p = point(e);
    if (typeof p.lat !== "number") continue;
    const tags = e.tags || {};
    if (tags.amenity === "parking") {
      parking.push({ ...p, fee: tags.fee, capacity: Number(tags.capacity) || null });
    } else if (tags.natural === "beach" && tags.name && !seen.has(tags.name)) {
      seen.add(tags.name); // the same beach is often mapped as several pieces
      beaches.push({
        id: `osm:${e.type}/${e.id}`,
        name: tags.name,
        ...p,
        surface: tags.surface,
        lifeguard: tags.lifeguard || tags.supervised,
        dogs: tags.dog,
      });
    }
  }
  for (const b of beaches) {
    const near = parking.filter((p) => distanceKm(b, p) <= PARKING_NEAR_KM);
    b.parkingLots = near.length;
    b.parkingSpaces = near.reduce((n, p) => n + (p.capacity || 0), 0);
    b.paidParking = near.some((p) => p.fee === "yes");
    b.distanceKm = distanceKm(center, b);
  }
  return beaches.sort((a, b) => a.distanceKm - b.distanceKm);
}

// Hourly weather for the next two days around { lat, lon }: [{ time: ms, tempC, precipMm, precipProb, windKmh }].
async function getWeather(center) {
  const params = new URLSearchParams({
    latitude: center.lat.toFixed(3),
    longitude: center.lon.toFixed(3),
    hourly: "temperature_2m,precipitation,precipitation_probability,wind_speed_10m,uv_index",
    forecast_days: "2",
    timeformat: "unixtime",
  });
  const json = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  const h = json.hourly;
  return h.time.map((t, i) => ({
    time: t * 1000,
    tempC: h.temperature_2m[i],
    precipMm: h.precipitation[i],
    precipProb: h.precipitation_probability[i],
    windKmh: h.wind_speed_10m[i],
    uv: h.uv_index ? h.uv_index[i] : null,
  }));
}

// The forecast hour closest to `time`.
function weatherAt(hours, time) {
  if (!hours || !hours.length) return null;
  return hours.reduce((best, h) => (Math.abs(h.time - time) < Math.abs(best.time - time) ? h : best));
}

// Turns a town, address or zip code into { lat, lon, label }.
async function geocode(text) {
  const params = new URLSearchParams({ q: text, format: "json", limit: "1" });
  const [hit] = await getJson(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "Accept-Language": navigator.language || "en" },
  });
  if (!hit) throw new Error(`Couldn't find "${text}"`);
  return { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name.split(",").slice(0, 2).join(",") };
}

// --- Reports -------------------------------------------------------------

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {};
  } catch {
    return {};
  }
}

function writeLocal(all) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    // storage blocked (private mode): the report just won't be remembered
  }
}

// Same shape as the API: { shared, reports: { id: [report] }, history: { id: { slot: { sum, count } } } }.
// `shared` is false when reports only live on this device.
async function getReports(ids) {
  try {
    const json = await getJson(`api/reports?ids=${encodeURIComponent(ids.join(","))}`);
    return { shared: true, ...json };
  } catch {
    const all = readLocal();
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    const reports = {};
    const history = {};
    for (const id of ids) {
      const entry = all[id] || { recent: [], history: {} };
      reports[id] = entry.recent.filter((r) => r.time >= cutoff);
      history[id] = entry.history;
    }
    return { shared: false, reports, history };
  }
}

// Sends a report; returns { shared } or throws with a message to show.
async function sendReport({ beachId, crowd, parking, note, slot }) {
  const body = { beachId, crowd, parking: parking || undefined, note: note || undefined, slot };
  let res;
  try {
    res = await fetch("api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    res = null;
  }
  if (res && res.ok) return { shared: true };
  if (res && (res.status === 400 || res.status === 429)) throw new Error((await res.json()).error);

  // No shared store (local preview, or not set up yet): keep it on this device.
  const all = readLocal();
  const entry = (all[beachId] = all[beachId] || { recent: [], history: {} });
  const report = { time: Date.now(), crowd };
  if (parking) report.parking = parking;
  if (note) report.note = note.slice(0, 140);
  entry.recent = [report, ...entry.recent].slice(0, 50);
  const s = (entry.history[slot] = entry.history[slot] || { sum: 0, count: 0 });
  s.sum += crowd;
  s.count += 1;
  writeLocal(all);
  return { shared: false };
}

if (typeof module !== "undefined") {
  module.exports = { parseOverpass, weatherAt };
}
