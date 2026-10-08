// Sample beaches near Los Angeles, for trying the site without live map data (open with ?demo).
// Reports are placed relative to now so the sample always has fresh ones.

const DEMO_CENTER = { lat: 33.93, lon: -118.43, label: "Los Angeles (sample)" };

const DEMO_BEACHES = [
  { id: "demo:santa-monica", name: "Santa Monica State Beach", lat: 34.0094, lon: -118.4973, parkingLots: 9, parkingSpaces: 2400, paidParking: true, lifeguard: "yes", surface: "sand" },
  { id: "demo:venice", name: "Venice Beach", lat: 33.985, lon: -118.4729, parkingLots: 6, parkingSpaces: 1100, paidParking: true, lifeguard: "yes", surface: "sand" },
  { id: "demo:dockweiler", name: "Dockweiler State Beach", lat: 33.9365, lon: -118.4366, parkingLots: 2, parkingSpaces: 600, paidParking: true, surface: "sand" },
  { id: "demo:manhattan", name: "Manhattan Beach", lat: 33.8847, lon: -118.4109, parkingLots: 5, parkingSpaces: 900, paidParking: true, lifeguard: "yes", surface: "sand" },
  { id: "demo:hermosa", name: "Hermosa Beach", lat: 33.8622, lon: -118.4012, parkingLots: 4, parkingSpaces: 700, paidParking: true, surface: "sand" },
  { id: "demo:redondo", name: "Redondo Beach", lat: 33.8395, lon: -118.3923, parkingLots: 3, parkingSpaces: 1500, paidParking: true, lifeguard: "yes", surface: "sand" },
  { id: "demo:el-segundo", name: "El Segundo Beach", lat: 33.9128, lon: -118.4232, parkingLots: 0, parkingSpaces: 0, paidParking: false, surface: "sand" },
];

const DEMO_REPORTS = {
  "demo:santa-monica": [
    { ago: 6, crowd: 5, parking: "full", note: "Pier lot full, try 4th St garage" },
    { ago: 25, crowd: 4, parking: "some" },
    { ago: 70, crowd: 4, parking: "some" },
  ],
  "demo:venice": [{ ago: 40, crowd: 3, parking: "some" }],
  "demo:manhattan": [
    { ago: 12, crowd: 2, parking: "plenty", note: "Lots of space north of the pier" },
    { ago: 55, crowd: 2, parking: "plenty" },
  ],
};

function demoReports(now = Date.now()) {
  const reports = {};
  for (const [id, list] of Object.entries(DEMO_REPORTS)) {
    reports[id] = list.map(({ ago, ...r }) => ({ ...r, time: now - ago * 60 * 1000 }));
  }
  return reports;
}

const DEMO_HISTORY = {
  "demo:hermosa": { "we:13": { sum: 22, count: 5 }, "we:14": { sum: 23, count: 5 }, "wd:14": { sum: 9, count: 4 } },
};
