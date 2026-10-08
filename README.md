# Beach Check

See how busy the beaches near you are before you leave: crowd level, parking, weather and directions.
Beachgoers report how crowded a beach is and how parking looks, and everyone sees it live. When
nobody has reported, the site estimates the crowd from the time of day, weekday or weekend, season,
the weather forecast and past reports for that beach.

Plain HTML, CSS and JavaScript. No build step.

## Santa Barbara first

The site opens on Santa Barbara. Its main public beaches come from a hand-checked list
(`js/santa-barbara.js`) instead of map data alone, which gets this area wrong (Hendry's and
Arroyo Burro listed as two beaches, a private beach included, Goleta Beach missing, almost no parking
details). Other mapped beaches nearby (More Mesa, Ellwood, ...) are added after it.

Parking for each beach lists the official lots, spaces, rates and hours:

- **City waterfront lots** (Leadbetter, Harbor West, Harbor Main, Stearns Wharf, Garden Street,
  Palm Park, Cabrillo East and West, SBCC La Playa): rates and hours from the City's
  [FY2026 Waterfront fee schedule](https://santabarbaraca.gov/sites/default/files/2026-02/FY26%20Waterfront%20Harbor%20Slip,%20Mooring,%20and%20User%20Fees%20-%20Full%20List%20of%20Fees.pdf)
  ($3.50/hr, $20/day max, 8 a.m.–10 p.m.; Stearns Wharf 90 min free then $4/hr); space counts from
  the City's [lot maps](https://santabarbaraca.gov/things-do/waterfront/waterfront-parking).
- **County beach parks** (Arroyo Burro, Goleta Beach, Lookout Park, Rincon Beach Park): hours
  (8 a.m.–sunset) and seasonal lifeguards from [County Parks](https://www.countyofsb.org/cd-parks-arroyo-burro-beach);
  the county [fee schedule](https://www.countyofsb.org/1096/Fee-Schedule) charges no day-use fee at these parks.
- **Carpinteria State Beach**: $10 vehicle day use, sunrise–sunset, no dogs on the beach, from
  [California State Parks](https://www.parks.ca.gov/?page_id=599).
- Street parking (Butterfly Beach, Isla Vista) and Carpinteria's Linden Ave lots from OpenStreetMap.

Santa Barbara has no live parking data to use: the City's real-time downtown parking page has been
retired, and the waterfront lots never had live counts. Live parking here comes from beachgoer reports.

## How it works

- **Beaches and parking**: OpenStreetMap (Overpass API): named beaches within 10–50 km, and parking
  lots within 600 m of each.
- **Live street parking (Los Angeles only)**: City of Los Angeles open data (LADOT parking meter
  occupancy), updated every minute by sensors in the meters. For beaches in the city (e.g. Venice),
  the card shows how many sensor-equipped street meters within 800 m are free right now. It covers
  street meters only, not beach lots, and ignores sensors that haven't reported for 24 hours.
  Checked and not used: Santa Monica's live lot API has been shut down, and Laguna Beach's
  parking app doesn't publish its data. Other beach cities checked publish no live counts.
- **Weather**: Open-Meteo hourly forecast (temperature, rain, wind, UV) for the time you plan to go.
- **Place search**: OpenStreetMap Nominatim, or the browser's location.
- **Live reports**: `api/reports.js`, a Vercel function storing reports in Upstash Redis. Recent
  reports (last 3 hours, newer ones count more) give the live crowd and parking. Every report also
  adds to that beach's totals per weekday/weekend hour, which improves future estimates.
- **Estimates** (`js/crowd.js`): typical hourly pattern × weekend boost × season (flipped south of
  the equator) × weather, blended with the beach's own past reports once there are at least 3.
- **Directions**: opens Google Maps driving directions to the beach.

Reports are checked against your location (must be within 2 km of the beach), limited to one per
beach every 10 minutes per visitor, and notes are capped at 140 characters.

## Run it

```sh
python3 -m http.server 8000   # open http://localhost:8000 (reports save to this device only)
                              # http://localhost:8000/?demo shows sample Los Angeles beaches
npx vercel dev                # full site including /api/reports
node --test tests/*.test.js   # run the tests
```

## Deploy

1. Import this repository on Vercel (no build settings needed).
2. Add an Upstash Redis store from the Vercel Marketplace (Storage → Upstash), which sets
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or set `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` yourself). Without it, reports are saved only on each visitor's device.

## Roadmap

1. [x] Find beaches near you, crowd estimates, parking, weather, directions
2. [x] Live beachgoer reports, with estimates that learn from past reports
3. [ ] Alerts: tell me when my favorite beach gets busy or parking fills up
4. [ ] Favorites and a "my beaches" view
5. [ ] Photos with reports, and up/down votes on reports to weed out bad ones
6. [ ] Tides, water quality and surf conditions
7. [ ] Accounts and reporter reputation
