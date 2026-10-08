# Beach Check

See how busy the beaches near you are before you leave: crowd level, parking, weather and directions.
Beachgoers report how crowded a beach is and how parking looks, and everyone sees it live. When
nobody has reported, the site estimates the crowd from the time of day, weekday or weekend, season,
the weather forecast and past reports for that beach.

Plain HTML, CSS and JavaScript. No build step.

## How it works

- **Beaches and parking**: OpenStreetMap (Overpass API): named beaches within 10–50 km, and parking
  lots within 600 m of each.
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
