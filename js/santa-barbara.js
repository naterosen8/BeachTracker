// Hand-checked Santa Barbara beaches and their parking, from city, county and state sources
// (listed in README.md). Map data alone gets this area wrong: duplicate names (Hendry's is
// Arroyo Burro), a private beach, missing Goleta Beach, and almost no parking details.
// Ids match OpenStreetMap, so reports line up with beaches found elsewhere on the map.

const SB_CENTER = { lat: 34.4105, lon: -119.6855, label: "Santa Barbara" }; // Stearns Wharf
// Searches centered in this box use the list below instead of the generic map lookup.
const SB_BOX = { south: 34.33, north: 34.48, west: -119.95, east: -119.42 };

// City waterfront lots: $3.50/hour, $20/day max, 8 a.m. to 10 p.m. (FY2026 fee schedule).
const CITY_RATE = "$3.50/hr, $20/day max";
const CITY_HOURS = "8 a.m.–10 p.m.";
const COUNTY_HOURS = "8 a.m.–sunset";

const SB_BEACHES = [
  {
    id: "osm:way/446745489", name: "Leadbetter Beach", lat: 34.4009, lon: -119.7006,
    lots: [
      { name: "Leadbetter Lot", spaces: 268, fee: CITY_RATE, hours: CITY_HOURS },
      { name: "Harbor West Lot", spaces: 199, fee: CITY_RATE, hours: CITY_HOURS },
      { name: "SBCC La Playa East & West Lots", fee: CITY_RATE, hours: "varies with City College events" },
    ],
  },
  {
    id: "osm:way/1050207589", name: "West Beach", lat: 34.4096, lon: -119.6909,
    summary: "2 lots · $3.50/hr (Stearns Wharf: 90 min free)",
    lots: [
      { name: "Harbor Main Lot", fee: "$3.50/hr, $20 per 24 hrs", hours: "open 24 hours, staffed kiosk" },
      { name: "Stearns Wharf", fee: "90 min free, then $4/hr", hours: CITY_HOURS },
    ],
  },
  {
    id: "osm:way/40117616", name: "East Beach", lat: 34.4145, lon: -119.6815,
    lots: [
      { name: "Garden Street Lot", spaces: 207, fee: CITY_RATE, hours: CITY_HOURS },
      { name: "Palm Park Lot", spaces: 267, fee: CITY_RATE, hours: CITY_HOURS },
      { name: "Cabrillo West Lot", spaces: 184, fee: CITY_RATE, hours: CITY_HOURS, note: "no vehicles over 20 ft" },
      { name: "Cabrillo East Lot", spaces: 82, fee: CITY_RATE, hours: CITY_HOURS, note: "no vehicles over 20 ft" },
    ],
  },
  {
    id: "osm:way/345801519", name: "Arroyo Burro Beach (Hendry's)", aliases: ["Hendrys Beach", "Hendry's Beach"],
    lat: 34.4027, lon: -119.7431, lifeguards: "seasonal", dogArea: true,
    lots: [{ name: "Arroyo Burro Beach Park lot (county)", fee: "free", hours: COUNTY_HOURS }],
  },
  {
    id: "osm:way/44486969", name: "Butterfly Beach", lat: 34.4176, lon: -119.649,
    lots: [{ name: "Street parking along Channel Drive", fee: "free", street: true }],
  },
  {
    id: "osm:way/44580911", name: "Goleta Beach", lat: 34.4166, lon: -119.8328, lifeguards: "seasonal",
    lots: [{ name: "Goleta Beach Park lot (county)", fee: "free", hours: COUNTY_HOURS }],
  },
  {
    id: "osm:way/446746847", name: "Isla Vista Beach", lat: 34.4071, lon: -119.8499,
    lots: [{ name: "Street parking in Isla Vista (no beach lot)", fee: "free", street: true }],
  },
  {
    id: "osm:way/784388342", name: "Summerland Beach (Lookout Park)", lat: 34.4188, lon: -119.5961,
    lots: [{ name: "Lookout Park lot (county)", fee: "free", hours: COUNTY_HOURS }],
  },
  {
    id: "osm:way/165156074", name: "Carpinteria State Beach", lat: 34.3913, lon: -119.5215,
    lifeguards: "yes", noDogsOnBeach: true,
    summary: "$10 state lot, or free city lots on Linden Ave",
    lots: [
      { name: "State beach day-use parking", fee: "$10 per vehicle", hours: "sunrise–sunset" },
      { name: "Carpinteria city lots 1–3 (Linden Ave)", fee: "free" },
    ],
  },
  {
    id: "osm:way/448594746", name: "Rincon Beach", lat: 34.3767, lon: -119.4807,
    lots: [
      { name: "Rincon Beach Park lot (county, Bates Rd)", fee: "free", hours: COUNTY_HOURS },
      { name: "Rincon Point lot (state parks)" },
    ],
  },
];

const inSantaBarbara = (p) => p.lat >= SB_BOX.south && p.lat <= SB_BOX.north && p.lon >= SB_BOX.west && p.lon <= SB_BOX.east;

// One-line parking summary for a hand-checked beach, e.g. "4 city lots, 740 spaces · $3.50/hr, $20/day max".
function sbParkingSummary(beach) {
  if (beach.summary) return beach.summary; // hand-written where the rule below reads awkwardly
  const lots = beach.lots.filter((l) => !l.street);
  const spaces = lots.reduce((n, l) => n + (l.spaces || 0), 0);
  if (!lots.length) return `${beach.lots[0].name} · free`;
  const where = `${lots.length} lot${lots.length > 1 ? "s" : ""}${spaces ? `, ${spaces}+ spaces` : ""}`;
  const fees = [...new Set(lots.map((l) => l.fee).filter(Boolean))];
  const unknown = lots.filter((l) => !l.fee).length;
  // Only state fees we've confirmed; say so when a lot's fee isn't known.
  const feeText = fees.length > 2 ? "rates vary" : fees.join(" or ");
  return `${where} · ${feeText}${unknown ? ` (fee unconfirmed at ${unknown})` : ""}`;
}

// Hand-checked beaches within radiusKm of center, shaped like findBeaches() results.
function sbBeaches(center, radiusKm) {
  return SB_BEACHES
    .map((b) => ({
      ...b,
      curated: true,
      distanceKm: distanceKm(center, b),
      parkingLots: b.lots.filter((l) => !l.street).length,
      parkingSpaces: b.lots.reduce((n, l) => n + (l.spaces || 0), 0),
      paidParking: b.lots.some((l) => l.fee && l.fee !== "free"),
      lifeguard: b.lifeguards ? "yes" : undefined,
    }))
    .filter((b) => b.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// Adds map beaches that aren't already on the hand-checked list (same place or name),
// leaving out private beaches and near-duplicates of each other.
function mergeWithCurated(curated, found) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
  const names = new Set(curated.flatMap((b) => [b.name, ...(b.aliases || [])]).map(norm));
  const kept = [...curated];
  for (const b of found) {
    if (/private/i.test(b.name) || names.has(norm(b.name))) continue;
    if (kept.some((k) => k.id === b.id || distanceKm(k, b) < 0.6)) continue;
    kept.push(b);
  }
  return kept.sort((a, b) => a.distanceKm - b.distanceKm);
}

if (typeof module !== "undefined") {
  module.exports = { SB_BEACHES, SB_CENTER, inSantaBarbara, sbParkingSummary, sbBeaches, mergeWithCurated };
}
