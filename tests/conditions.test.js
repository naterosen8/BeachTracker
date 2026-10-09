const test = require("node:test");
const assert = require("node:assert");
Object.assign(global, require("../js/crowd.js"));
global.HOUR_MS = 60 * 60 * 1000;
const { tideTurns, tideAt, surfLabel, marineAt, sunTimes, dayForecast, daySummary } = require("../js/conditions.js");

const H = 60 * 60 * 1000;
// Santa Barbara sea level from Open-Meteo, hourly.
const LEVELS = [0.3, 0.66, 0.96, 1.12, 1.12, 0.94, 0.63, 0.27, -0.04, -0.22, -0.23, -0.06, 0.25, 0.64, 0.99, 1.22, 1.27, 1.13];
const curve = LEVELS.map((level, i) => ({ time: i * H, level }));

test("finds tide highs and lows between the hours", () => {
  const turns = tideTurns(curve);
  assert.deepStrictEqual(turns.map((t) => t.type), ["high", "low", "high"]);
  // The first high sits between hours 3 and 4, which read the same.
  assert.ok(turns[0].time > 3 * H && turns[0].time < 4 * H);
  assert.ok(turns[0].level >= 1.12);
  assert.ok(turns[1].time > 9 * H && turns[1].time < 10.5 * H);
  assert.ok(turns[1].level <= -0.22);
});

test("tideAt says rising or falling and what comes next", () => {
  const t = tideAt(curve, 6 * H);
  assert.strictEqual(t.rising, false);
  assert.strictEqual(t.next.type, "low");
  assert.strictEqual(t.after.type, "high");
  assert.strictEqual(tideAt(curve, 20 * H), null);
});

test("surf labels and closest marine hour", () => {
  assert.strictEqual(surfLabel(0.1), "Flat");
  assert.strictEqual(surfLabel(0.9), "Moderate surf");
  assert.strictEqual(surfLabel(null), null);
  const hours = [{ time: 0, waveM: 1 }, { time: H, waveM: 2 }];
  assert.strictEqual(marineAt(hours, 0.7 * H).waveM, 2);
  assert.strictEqual(marineAt(hours, 10 * H), null); // too far from any hour
});

test("sunrise and sunset in Santa Barbara", () => {
  // Oct 9 2026: solar noon is 12:46 p.m. PDT (19:46 UTC), with about 11 h 32 min of daylight.
  const day = new Date(Date.UTC(2026, 9, 9, 19)); // local noon in Santa Barbara
  const { sunrise, sunset } = sunTimes(day, 34.41, -119.69);
  const noon = (sunrise + sunset) / 2;
  assert.ok(Math.abs(noon - Date.UTC(2026, 9, 9, 19, 46)) < 3 * 60 * 1000, new Date(noon).toISOString());
  assert.ok(Math.abs((sunset - sunrise) / 60000 - (11 * 60 + 32)) < 5);
  assert.strictEqual(sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 89, 0), null); // midnight sun
});

test("day forecast peaks mid-afternoon and summarizes it", () => {
  const day = new Date(2026, 6, 11); // a Saturday in July
  const hours = dayForecast({ day, lat: 34.4 });
  assert.strictEqual(hours.length, 15);
  const peak = hours.reduce((a, b) => (b.crowd > a.crowd ? b : a));
  assert.ok(peak.hour >= 12 && peak.hour <= 15);
  const text = daySummary(hours);
  assert.match(text, /^Busiest .*PM · quieter before \d+ AM/);
});

test("flat days say so", () => {
  const hours = [6, 7, 8].map((hour) => ({ hour, crowd: 1.2 }));
  assert.strictEqual(daySummary(hours), "About the same all day: empty");
});
