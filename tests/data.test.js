const test = require("node:test");
const assert = require("node:assert");
global.distanceKm = require("../js/crowd.js").distanceKm;
const { parseOverpass, parsePhotonBeaches, findBeaches, weatherAt, geocode } = require("../js/data.js");

test("parses beaches, merges duplicates and counts nearby parking", () => {
  const center = { lat: 33.9, lon: -118.42 };
  const beaches = parseOverpass({
    elements: [
      { type: "way", id: 1, center: { lat: 33.8847, lon: -118.4109 }, tags: { natural: "beach", name: "Manhattan Beach", lifeguard: "yes" } },
      { type: "way", id: 2, center: { lat: 33.89, lon: -118.411 }, tags: { natural: "beach", name: "Manhattan Beach" } },
      { type: "node", id: 3, lat: 34.0094, lon: -118.4973, tags: { natural: "beach", name: "Santa Monica" } },
      { type: "way", id: 4, center: { lat: 33.886, lon: -118.409 }, tags: { amenity: "parking", fee: "yes", capacity: "200" } },
      { type: "node", id: 5, lat: 33.883, lon: -118.41, tags: { amenity: "parking" } },
      { type: "node", id: 6, lat: 34.2, lon: -118.4, tags: { amenity: "parking" } },
    ],
  }, center);
  assert.deepStrictEqual(beaches.map((b) => b.name), ["Manhattan Beach", "Santa Monica"]);
  const mb = beaches[0];
  assert.strictEqual(mb.id, "osm:way/1");
  assert.strictEqual(mb.parkingLots, 2);
  assert.strictEqual(mb.parkingSpaces, 200);
  assert.strictEqual(mb.paidParking, true);
  assert.strictEqual(mb.lifeguard, "yes");
  assert.strictEqual(beaches[1].parkingLots, 0);
});

test("weatherAt picks the closest forecast hour", () => {
  const hours = [{ time: 0, tempC: 20 }, { time: 3600e3, tempC: 25 }, { time: 7200e3, tempC: 22 }];
  assert.strictEqual(weatherAt(hours, 3000e3).tempC, 25);
  assert.strictEqual(weatherAt([], 0), null);
});

// Fakes fetch: answers each host from `routes`, or fails like a blocked network.
function fakeFetch(t, routes) {
  const hosts = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const { host } = new URL(url);
    hosts.push(host);
    const route = routes[host];
    if (!route) throw new TypeError("Failed to fetch");
    const [status, body] = route(url);
    return { ok: status === 200, status, json: async () => body };
  });
  return hosts;
}

test("zip codes are looked up on Zippopotam first", async (t) => {
  const hosts = fakeFetch(t, {
    "api.zippopotam.us": () => [200, { places: [{ "place name": "Ojai", "state abbreviation": "CA", latitude: "34.4483", longitude: "-119.2457" }] }],
  });
  const hit = await geocode("93023");
  assert.deepStrictEqual(hit, { lat: 34.4483, lon: -119.2457, label: "Ojai, CA 93023" });
  assert.deepStrictEqual(hosts, ["api.zippopotam.us"]);
});

test("zip lookup falls back to a structured Nominatim postcode search", async (t) => {
  let asked;
  fakeFetch(t, {
    "nominatim.openstreetmap.org": (url) => {
      asked = new URL(url).searchParams;
      return [200, [{ lat: "34.45", lon: "-119.24", display_name: "Ojai, Ventura County, California" }]];
    },
  });
  const hit = await geocode(" 93023-1234 ");
  assert.strictEqual(asked.get("postalcode"), "93023");
  assert.strictEqual(asked.get("countrycodes"), "us");
  assert.strictEqual(hit.label, "Ojai, Ventura County");
});

test("town names fall back to Photon when Nominatim is down", async (t) => {
  fakeFetch(t, {
    "nominatim.openstreetmap.org": () => [503, null],
    "photon.komoot.io": () => [200, { features: [{ geometry: { coordinates: [-119.29, 34.28] }, properties: { name: "Ventura", state: "California" } }] }],
  });
  assert.deepStrictEqual(await geocode("Ventura"), { lat: 34.28, lon: -119.29, label: "Ventura, California" });
});

test("geocode says whether the place is unknown or search is unreachable", async (t) => {
  fakeFetch(t, { "nominatim.openstreetmap.org": () => [200, []], "photon.komoot.io": () => [200, { features: [] }] });
  await assert.rejects(geocode("Nowhereville"), /Couldn't find "Nowhereville"/);
  t.mock.restoreAll();
  fakeFetch(t, {});
  await assert.rejects(geocode("Ventura"), /isn't reachable right now \(nominatim.openstreetmap.org unreachable; photon.komoot.io unreachable\)/);
});

const photonFeature = (type, id, name, lon, lat) =>
  ({ geometry: { coordinates: [lon, lat] }, properties: { osm_type: type, osm_id: id, name } });

test("parses Photon beaches: same ids as OpenStreetMap, no duplicates, within the radius", () => {
  const center = { lat: 34.4451, lon: -119.2565 };
  const beaches = parsePhotonBeaches([
    photonFeature("R", 17606635, "Emma Wood State Beach", -119.33, 34.285),
    photonFeature("W", 38246794, "Rincon Beach", -119.476, 34.373),
    photonFeature("W", 448594746, "Rincon beach", -119.477, 34.374),
    photonFeature("R", 6170634, "Zuma Beach", -118.82, 34.015),
    photonFeature("N", 1, "", -119.3, 34.3),
  ], center, 25);
  assert.deepStrictEqual(beaches.map((b) => [b.id, b.name]), [
    ["osm:relation/17606635", "Emma Wood State Beach"],
    ["osm:way/38246794", "Rincon Beach"],
  ]);
  assert.strictEqual(beaches[0].parkingLots, null);
});

test("findBeaches falls back to Photon when Overpass is down, then skips Overpass", async (t) => {
  const hosts = fakeFetch(t, {
    "photon.komoot.io": (url) => {
      const tag = new URL(url).searchParams.get("osm_tag");
      return [200, { features: tag === "natural:beach"
        ? [photonFeature("R", 1, "Emma Wood State Beach", -119.33, 34.285)]
        : [photonFeature("W", 2, "Lot", -119.3302, 34.2851), photonFeature("W", 3, "Far lot", -119.2, 34.4)] }];
    },
  });
  const center = { lat: 34.4451, lon: -119.2565 };
  const beaches = await findBeaches(center, 25);
  assert.deepStrictEqual(beaches.map((b) => [b.name, b.parkingLots]), [["Emma Wood State Beach", 1]]);
  assert.ok(hosts.includes("overpass-api.de"));

  hosts.length = 0;
  await findBeaches(center, 25);
  assert.ok(!hosts.some((h) => h.includes("overpass")), `asked ${hosts}`);
});
