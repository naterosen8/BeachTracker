const test = require("node:test");
const assert = require("node:assert");
global.distanceKm = require("../js/crowd.js").distanceKm;
const { SB_BEACHES, SB_CENTER, inSantaBarbara, sbParkingSummary, sbBeaches, mergeWithCurated } = require("../js/santa-barbara.js");

test("every hand-checked beach has a unique map id, a location in the area, and parking info", () => {
  assert.strictEqual(new Set(SB_BEACHES.map((b) => b.id)).size, SB_BEACHES.length);
  for (const b of SB_BEACHES) {
    assert.match(b.id, /^osm:(node|way|relation)\/\d+$/, b.name);
    assert.ok(inSantaBarbara(b), `${b.name} outside the area`);
    assert.ok(b.lots.length > 0, `${b.name} has no parking`);
  }
});

test("parking summaries add up the official lot sizes", () => {
  const east = SB_BEACHES.find((b) => b.name === "East Beach");
  assert.strictEqual(sbParkingSummary(east), "4 lots, 740+ spaces · $3.50/hr, $20/day max");
  const butterfly = SB_BEACHES.find((b) => b.name === "Butterfly Beach");
  assert.strictEqual(sbParkingSummary(butterfly), "Street parking along Channel Drive · free");
  const carp = SB_BEACHES.find((b) => b.name === "Carpinteria State Beach");
  assert.strictEqual(sbParkingSummary(carp), "$10 state lot, or free city lots on Linden Ave");
  const rincon = SB_BEACHES.find((b) => b.name === "Rincon Beach");
  assert.strictEqual(sbParkingSummary(rincon), "2 lots · free (fee unconfirmed at 1)");
});

test("hand-checked beaches are filtered by distance and sorted", () => {
  const near = sbBeaches(SB_CENTER, 5);
  assert.deepStrictEqual(near.map((b) => b.name), ["West Beach", "East Beach", "Leadbetter Beach", "Butterfly Beach"]);
  assert.ok(near.every((b) => b.curated));
  assert.deepStrictEqual(sbBeaches({ lat: 34.4451, lon: -119.2565 }, 25).map((b) => b.name), ["Rincon Beach"]); // from Ojai
});

test("map beaches are added only when they're new, public and not duplicates", () => {
  const curated = sbBeaches(SB_CENTER, 25);
  const at = (name, id, lat, lon) => ({ name, id, lat, lon, distanceKm: distanceKm(SB_CENTER, { lat, lon }) });
  const merged = mergeWithCurated(curated, [
    at("Hendrys Beach", "osm:way/345801521", 34.3999, -119.7374), // same beach as Arroyo Burro
    at("Hope Ranch Private Beach", "osm:node/358848299", 34.4131, -119.7762),
    at("Summerland Beach Cove", "osm:node/6403360922", 34.4178, -119.5917), // next to Summerland
    at("More Mesa Beach", "osm:way/250245535", 34.4183, -119.7962),
    at("More Mesa Nude Beach", "osm:node/6403360920", 34.4174, -119.7898),
    at("East Beach", "osm:way/40117616", 34.4145, -119.6815),
  ]);
  const added = merged.filter((b) => !b.curated).map((b) => b.name);
  assert.deepStrictEqual(added, ["More Mesa Beach"]); // the nude beach is 580 m along the same strip
  assert.strictEqual(merged.filter((b) => b.name === "East Beach").length, 1);
});
