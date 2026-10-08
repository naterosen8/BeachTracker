// Loads beaches and parking (OpenStreetMap), weather (Open-Meteo), place search (Zippopotam,
// Nominatim, Photon), and beachgoer reports (our /api/reports, or this device's storage when
// that isn't set up).

// Public Overpass servers are often busy, so try several.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const PARKING_NEAR_KM = 0.6;
const LOCAL_KEY = "beachcheck.reports";
const TIMEOUT_MS = 20000;

async function getJson(url, options = {}) {
  const host = new URL(url).host;
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout || TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`${host} ${err.name === "TimeoutError" ? "timed out" : "unreachable"}`);
  }
  if (!res.ok) throw new Error(`${host} returned ${res.status}`);
  return res.json();
}

// Named beaches within radiusKm of { lat, lon }, with a count of parking lots near each.
// Parking is only looked up around the beaches found, which keeps the query light.
async function findBeaches(center, radiusKm = 25) {
  const r = Math.round(radiusKm * 1000);
  const query = `[out:json][timeout:25];
nwr["natural"="beach"]["name"](around:${r},${center.lat},${center.lon})->.beaches;
.beaches out tags center 80;
nwr["amenity"="parking"](around.beaches:${PARKING_NEAR_KM * 1000});
out center 1000;`;
  const failures = [];
  for (const url of OVERPASS_URLS) {
    try {
      const json = await getJson(url, { method: "POST", body: new URLSearchParams({ data: query }), timeout: 30000 });
      return parseOverpass(json, center);
    } catch (err) {
      failures.push(err.message);
    }
  }
  throw new Error(`Couldn't load beaches: the map servers are busy (${failures.join("; ")})`);
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

const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

// US zip codes: Zippopotam.us knows every one and answers fast.
async function zipLookup(text) {
  const zip = text.slice(0, 5);
  const json = await getJson(`https://api.zippopotam.us/us/${zip}`).catch((err) => {
    if (/ 404$/.test(err.message)) return null; // not a real zip
    throw err;
  });
  const place = json && json.places && json.places[0];
  if (!place) return null;
  return {
    lat: Number(place.latitude),
    lon: Number(place.longitude),
    label: `${place["place name"]}, ${place["state abbreviation"]} ${zip}`,
  };
}

async function nominatimLookup(text) {
  const params = new URLSearchParams({ format: "json", limit: "1", "accept-language": navigator.language || "en" });
  if (US_ZIP_RE.test(text)) {
    params.set("postalcode", text.slice(0, 5));
    params.set("countrycodes", "us");
  } else {
    params.set("q", text);
  }
  const [hit] = await getJson(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!hit) return null;
  return { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name.split(",").slice(0, 2).join(",") };
}

async function photonLookup(text) {
  const params = new URLSearchParams({ q: text, limit: "1" });
  const json = await getJson(`https://photon.komoot.io/api/?${params}`);
  const hit = json.features && json.features[0];
  if (!hit) return null;
  const p = hit.properties || {};
  const [lon, lat] = hit.geometry.coordinates;
  return { lat, lon, label: [p.name || p.city, p.state || p.country].filter(Boolean).join(", ") || text };
}

// Turns a town, address or zip code into { lat, lon, label }, trying several services in turn.
async function geocode(input) {
  const text = input.trim();
  const lookups = US_ZIP_RE.test(text) ? [zipLookup, nominatimLookup, photonLookup] : [nominatimLookup, photonLookup];
  const failures = [];
  for (const lookup of lookups) {
    try {
      const hit = await lookup(text);
      if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lon)) return hit;
    } catch (err) {
      failures.push(err.message);
    }
  }
  if (failures.length === lookups.length) {
    throw new Error(`Place search isn't reachable right now (${failures.join("; ")}). Try "Use my location".`);
  }
  throw new Error(`Couldn't find "${text}". Try a town name or zip code.`);
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
  module.exports = { parseOverpass, weatherAt, geocode };
}
