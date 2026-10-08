// Crowd math: combine live user reports, and estimate crowds from trends when there are none.
// Pure functions, no DOM, so it can be tested in Node.

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;

const CROWD_LABELS = ["Empty", "Quiet", "Moderate", "Busy", "Packed"]; // levels 1..5
const PARKING_LABELS = { plenty: "Plenty of parking", some: "Some spots left", full: "Parking full" };

const LIVE_WINDOW_MS = 3 * HOUR_MS; // older reports say little about right now
const HALF_LIFE_MS = 45 * MIN_MS; // a report loses half its weight every 45 minutes
const MIN_HISTORY = 3; // past reports needed in a time slot before we lean on them

// How busy a typical beach is by local hour, 0 (empty) to 1 (as busy as it gets that day).
const HOUR_CURVE = [
  0, 0, 0, 0, 0, 0.02, 0.05, 0.1, 0.18, 0.3, 0.45, 0.6,
  0.75, 0.85, 0.85, 0.8, 0.68, 0.52, 0.38, 0.22, 0.1, 0.04, 0.02, 0,
];

const crowdLabel = (level) => CROWD_LABELS[Math.min(5, Math.max(1, Math.round(level))) - 1];

// Great-circle distance in km between { lat, lon } points.
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Rough drive time: roads wind ~30% more than a straight line. Short trips are mostly town streets
// (~30 km/h); longer ones are mostly highway, so the average speed rises with distance, up to 70 km/h.
const driveMinutes = (km) => Math.max(1, Math.round(((km * 1.3) / Math.min(70, 30 + km * 1.5)) * 60));

const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;

// Time slot used to group past reports: weekday/weekend plus local hour, e.g. "we:14".
const slotKey = (date) => `${isWeekend(date) ? "we" : "wd"}:${date.getHours()}`;

function partOfDay(hour) {
  if (hour < 6 || hour >= 21) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

// What beachgoers are reporting right now. Recent reports count most.
// reports: [{ time: ms, crowd: 1..5, parking?: "plenty"|"some"|"full" }]
// Returns null when there's nothing recent enough.
function liveStatus(reports, now = Date.now()) {
  const recent = reports.filter((r) => now - r.time >= -MIN_MS && now - r.time <= LIVE_WINDOW_MS);
  if (!recent.length) return null;
  let crowdSum = 0;
  let weightSum = 0;
  const parkingVotes = {};
  for (const r of recent) {
    const w = 0.5 ** (Math.max(0, now - r.time) / HALF_LIFE_MS);
    crowdSum += r.crowd * w;
    weightSum += w;
    if (r.parking) parkingVotes[r.parking] = (parkingVotes[r.parking] || 0) + w;
  }
  const parkingEntries = Object.entries(parkingVotes).sort((a, b) => b[1] - a[1]);
  const newest = Math.max(...recent.map((r) => r.time));
  return {
    crowd: crowdSum / weightSum,
    parking: parkingEntries.length ? parkingEntries[0][0] : null,
    count: recent.length,
    newest,
    notes: recent.filter((r) => r.note).sort((a, b) => b.time - a.time).slice(0, 3),
  };
}

// 0..1: how much of peak summer crowds to expect in this month at this latitude.
function seasonFactor(month, lat) {
  if (Math.abs(lat) < 23.5) return 0.85; // tropics: beach weather all year
  const m = lat >= 0 ? month : (month + 6) % 12; // flip seasons south of the equator
  //           Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
  return [0.2, 0.2, 0.3, 0.45, 0.7, 0.95, 1, 1, 0.7, 0.45, 0.25, 0.2][m];
}

// weather: { tempC, precipMm, precipProb, windKmh } for the hour you're going (any may be missing).
function weatherFactor(weather) {
  if (!weather) return { factor: 1, reasons: [] };
  let factor = 1;
  const reasons = [];
  const { tempC, precipMm, precipProb, windKmh } = weather;
  if (typeof tempC === "number") {
    if (tempC < 15) { factor *= 0.3; reasons.push("Cold"); }
    else if (tempC < 20) { factor *= 0.6; reasons.push("Cool"); }
    else if (tempC < 25) { factor *= 0.85; reasons.push("Mild"); }
    else if (tempC <= 35) reasons.push("Warm");
    else { factor *= 0.9; reasons.push("Very hot"); }
  }
  if (precipMm > 0.5) { factor *= 0.3; reasons.push("Raining"); }
  else if (precipProb >= 60) { factor *= 0.6; reasons.push(`${Math.round(precipProb)}% chance of rain`); }
  if (windKmh >= 35) { factor *= 0.6; reasons.push("Windy"); }
  return { factor, reasons };
}

// Best guess at the crowd when nobody has reported, from time, season, weather and past reports.
// history: { "we:14": { sum, count } } - past reports at this beach, grouped by slotKey().
// Returns { crowd: 1..5, reasons: [string], fromHistory: number of past reports used }.
function estimateCrowd({ date, lat, weather, history }) {
  const hour = date.getHours();
  const weekend = isWeekend(date);
  const reasons = [`${weekend ? "Weekend" : "Weekday"} ${partOfDay(hour)}`];
  const season = seasonFactor(date.getMonth(), lat);
  if (season >= 0.9) reasons.push("Peak season");
  else if (season <= 0.3) reasons.push("Off season");
  const w = weatherFactor(weather);
  reasons.push(...w.reasons);

  const score = HOUR_CURVE[hour] * (weekend ? 1.15 : 0.7) * season * w.factor;
  let crowd = 1 + 4 * Math.min(1, score);

  const past = history && history[slotKey(date)];
  let fromHistory = 0;
  if (past && past.count >= MIN_HISTORY) {
    fromHistory = past.count;
    const trust = Math.min(0.8, past.count / 10);
    crowd = trust * (past.sum / past.count) + (1 - trust) * crowd;
    reasons.push(`${past.count} past reports at this time`);
  }
  return { crowd, reasons, fromHistory };
}

if (typeof module !== "undefined") {
  module.exports = {
    CROWD_LABELS, PARKING_LABELS, crowdLabel, distanceKm, driveMinutes, isWeekend, slotKey,
    liveStatus, seasonFactor, weatherFactor, estimateCrowd,
  };
}
