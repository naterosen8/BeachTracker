const test = require("node:test");
const assert = require("node:assert");
global.distanceKm = require("../js/crowd.js").distanceKm;
const { getMeters, summarizeMeters, inLosAngeles } = require("../js/meters.js");

const NOW = Date.UTC(2026, 9, 8, 17, 30);
const venice = { id: "osm:way/1", name: "Venice Beach", lat: 33.985, lon: -118.4729 };
const meter = (id, lat, lon) => ({ spaceid: id, latlng: { latitude: String(lat), longitude: String(lon) } });
const state = (id, minutesAgo, occupancystate) => ({
  spaceid: id,
  occupancystate,
  eventtime: new Date(NOW - minutesAgo * 60000).toISOString().replace("Z", ""), // LADOT style: UTC, no zone
});

test("only beaches in Los Angeles are looked up", () => {
  assert.ok(inLosAngeles(venice));
  assert.ok(!inLosAngeles({ lat: 34.2747, lon: -119.3003 })); // Ventura
  assert.ok(!inLosAngeles({ lat: 25.79, lon: -80.13 })); // Miami Beach
});

test("counts free street meters near a beach and ignores silent or far sensors", () => {
  const inventory = [
    meter("A", 33.9877, -118.4725), meter("B", 33.9878, -118.4726), meter("C", 33.988, -118.4727),
    meter("D", 33.9881, -118.4728), meter("STALE", 33.9879, -118.4725), meter("FAR", 34.05, -118.25),
  ];
  const occupancy = [
    state("A", 2, "VACANT"), state("B", 5, "OCCUPIED"), state("C", 30, "VACANT"), state("D", 1, "OCCUPIED"),
    state("STALE", 3 * 24 * 60, "VACANT"), state("FAR", 1, "VACANT"), state("UNKNOWN", 1, "VACANT"),
  ];
  assert.deepStrictEqual(summarizeMeters([venice], inventory, occupancy, NOW), {
    "osm:way/1": { free: 2, total: 4, newest: NOW - 60000 },
  });
});

test("too few sensors near a beach shows nothing", () => {
  const inventory = [meter("A", 33.9877, -118.4725), meter("B", 33.9878, -118.4726)];
  const occupancy = [state("A", 2, "VACANT"), state("B", 2, "VACANT")];
  assert.deepStrictEqual(summarizeMeters([venice], inventory, occupancy, NOW), {});
});

test("getMeters asks for meters around LA beaches only, then their sensor states", async () => {
  const urls = [];
  const fetchJson = async (url) => {
    urls.push(decodeURIComponent(url));
    return urls.length === 1 ? [meter("A1", 33.9877, -118.4725), meter("B'2", 33.9878, -118.4726)] : [];
  };
  const ventura = { id: "osm:way/2", lat: 34.2747, lon: -119.3003 };
  assert.deepStrictEqual(await getMeters([venice, ventura], fetchJson), {});
  assert.strictEqual(urls.length, 2);
  assert.match(urls[0], /s49e-q6j2\.json.*within_circle\(latlng, 33\.98500, -118\.47290, 800\)$/);
  assert.ok(!urls[0].includes("119.3"));
  assert.match(urls[1], /e7h6-4a3e\.json.*spaceid in\('A1','B''2'\)$/);
});

test("no LA beaches means no requests", async () => {
  let called = false;
  const result = await getMeters([{ id: "x", lat: 34.27, lon: -119.3 }], async () => { called = true; });
  assert.deepStrictEqual(result, {});
  assert.strictEqual(called, false);
});
