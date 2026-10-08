const test = require("node:test");
const assert = require("node:assert");
global.distanceKm = require("../js/crowd.js").distanceKm;
const { parseOverpass, weatherAt } = require("../js/data.js");

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
