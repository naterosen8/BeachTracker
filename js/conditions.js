// Beach conditions: tides, surf, water temperature, sunrise/sunset, and the crowd through the day.
// Pure functions, no DOM, so it can be tested in Node.

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_HOUR = 6; // the hour-by-hour forecast covers 6 a.m. ...
const LAST_HOUR = 20; // ... to 8 p.m.

// Highs and lows from an hourly sea-level curve [{ time, level }]. Each turning point is fitted with
// a parabola through its neighbours, so times land between the hours.
// Returns [{ type: "high"|"low", time, level }] in time order.
function tideTurns(hours) {
  const turns = [];
  for (let i = 1; i + 1 < hours.length; i++) {
    const [a, b, c] = [hours[i - 1].level, hours[i].level, hours[i + 1].level];
    if ([a, b, c].some((v) => typeof v !== "number")) continue;
    const high = b > a && b >= c;
    const low = b < a && b <= c;
    if (!high && !low) continue;
    const bend = a - 2 * b + c;
    const offset = bend ? (a - c) / (2 * bend) : 0; // in steps, -0.5..0.5
    const step = hours[i + 1].time - hours[i].time;
    turns.push({
      type: high ? "high" : "low",
      time: Math.round(hours[i].time + offset * step),
      level: b - ((a - c) * offset) / 4,
    });
  }
  return turns;
}

// The tide around `time`: rising or falling, and the next high or low after it.
function tideAt(hours, time) {
  const turns = tideTurns(hours);
  const next = turns.find((t) => t.time > time);
  if (!next) return null;
  const after = turns.find((t) => t.time > next.time) || null;
  return { rising: next.type === "high", next, after };
}

// Plain-words wave size from height in metres.
function surfLabel(m) {
  if (typeof m !== "number") return null;
  if (m < 0.3) return "Flat";
  if (m < 0.9) return "Small waves";
  if (m < 1.5) return "Moderate surf";
  if (m < 2.5) return "Big surf";
  return "Very big surf";
}

// The hour of marine data closest to `time`.
function marineAt(hours, time) {
  if (!hours || !hours.length) return null;
  const best = hours.reduce((b, h) => (Math.abs(h.time - time) < Math.abs(b.time - time) ? h : b));
  return Math.abs(best.time - time) <= 2 * HOUR_MS ? best : null;
}

// Sunrise and sunset (ms) on the local calendar day of `date` at { lat, lon }, from the
// standard sunrise equation (accurate to a minute or two). null when the sun doesn't rise or set.
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const n = Math.round(noon.getTime() / DAY_MS + 2440587.5 - 2451545 + lon / 360);
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const sinDec = Math.sin(L * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW) / rad;
  const toMs = (j) => Math.round((j - 2440587.5) * DAY_MS);
  return { sunrise: toMs(transit - w / 360), sunset: toMs(transit + w / 360) };
}

// Estimated crowd for each hour of `day` from FIRST_HOUR to LAST_HOUR.
// weatherFor(ms) returns the forecast for that time, or null.
function dayForecast({ day, lat, weatherFor, history }) {
  const hours = [];
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
    const date = new Date(day);
    date.setHours(h, 0, 0, 0);
    const weather = weatherFor ? weatherFor(date.getTime()) : null;
    hours.push({ hour: h, time: date.getTime(), crowd: estimateCrowd({ date, lat, weather, history }).crowd });
  }
  return hours;
}

const hourText = (h) => `${h % 12 || 12}${h < 12 || h === 24 ? " AM" : " PM"}`;

// "1–3 PM", or "11 AM–1 PM" when the range crosses noon.
function rangeText(from, to) {
  const sameHalf = (from < 12) === (to < 12);
  return `${sameHalf ? from % 12 || 12 : hourText(from)}–${hourText(to)}`;
}

// One line about the day's shape, e.g. "Busiest 1–3 PM · quieter before 11 AM and after 5 PM"
function daySummary(hours) {
  if (!hours.length) return "";
  const levels = hours.map((h) => h.crowd);
  const max = Math.max(...levels);
  const min = Math.min(...levels);
  if (max - min < 0.5) return `About the same all day: ${crowdLabel((max + min) / 2).toLowerCase()}`;
  const peak = hours.filter((h) => h.crowd >= max - 0.25);
  const peakText = peak.length > 1
    ? `Busiest ${rangeText(peak[0].hour, peak[peak.length - 1].hour + 1)}`
    : `Busiest around ${hourText(peak[0].hour)}`;
  const mid = (max + min) / 2;
  const firstBusy = hours.find((h) => h.crowd >= mid);
  const lastBusy = [...hours].reverse().find((h) => h.crowd >= mid);
  const quiet = [];
  if (firstBusy && firstBusy.hour > FIRST_HOUR) quiet.push(`before ${hourText(firstBusy.hour)}`);
  if (lastBusy && lastBusy.hour < LAST_HOUR) quiet.push(`after ${hourText(lastBusy.hour + 1)}`);
  return quiet.length ? `${peakText} · quieter ${quiet.join(" and ")}` : peakText;
}

if (typeof module !== "undefined") {
  module.exports = { tideTurns, tideAt, surfLabel, marineAt, sunTimes, dayForecast, daySummary, hourText, FIRST_HOUR, LAST_HOUR };
}
