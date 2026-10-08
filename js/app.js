// Wires location search, beach data, crowd estimates, the map and report forms together.

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 2 * 60 * 1000;
const NEAR_BEACH_KM = 2; // reports only count from people at (or right next to) the beach
const imperial = /^en-(US|LR)|^my\b/.test(navigator.language || "");
const demo = new URLSearchParams(location.search).has("demo");

const state = {
  center: null, // { lat, lon, label }
  beaches: [],
  weather: null,
  reports: {},
  history: {},
  shared: true,
  meters: {}, // live LA street-meter counts by beach id
};
let map = null;
let markers = null;

// --- Formatting ------------------------------------------------------------

const fmtDistance = (km) =>
  imperial ? `${(km * 0.621371).toFixed(km < 16 ? 1 : 0)} mi` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
const fmtTemp = (c) => (imperial ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`);

function ago(time) {
  const min = Math.round((Date.now() - time) / 60000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// --- Planning ------------------------------------------------------------

// The time the person plans to arrive, from the "Going" menu.
function targetTime() {
  const v = $("when").value;
  if (v.startsWith("tomorrow-")) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(Number(v.split("-")[1]), 0, 0, 0);
    return d;
  }
  return new Date(Date.now() + Number(v) * HOUR_MS);
}

// Everything we know about one beach for the chosen arrival time.
function describe(beach, when) {
  const goingNow = when - Date.now() < HOUR_MS / 2;
  const live = liveStatus(state.reports[beach.id] || []);
  const weather = state.weather ? weatherAt(state.weather, when.getTime()) : null;
  const est = estimateCrowd({ date: when, lat: beach.lat, weather, history: state.history[beach.id] });
  const useLive = live && goingNow;
  const crowd = useLive ? live.crowd : est.crowd;

  let parking;
  if (useLive && live.parking) {
    parking = { text: `${PARKING_LABELS[live.parking]} (reported)`, score: { plenty: 3, some: 2, full: 0 }[live.parking] };
  } else if (beach.curated) {
    const street = beach.lots.every((l) => l.street);
    const roomy = beach.parkingSpaces >= 200 || beach.lots.some((l) => l.fee === "free" && !l.street);
    parking = {
      text: `${sbParkingSummary(beach)}${crowd >= 4 ? " (busy: may fill up)" : ""}`,
      score: (street ? 1 : roomy ? 2.5 : 2) - (crowd >= 4 ? 1 : 0),
    };
  } else if (beach.parkingLots) {
    const lots = `${beach.parkingLots} lot${beach.parkingLots > 1 ? "s" : ""} nearby${beach.paidParking ? " (some paid)" : ""}`;
    parking = crowd >= 4
      ? { text: `${lots}, likely filling up`, score: 1 }
      : { text: `${lots}, probably spaces`, score: 2 };
  } else if (beach.parkingLots === 0) {
    parking = { text: "No mapped parking nearby: expect street parking", score: 0.5 };
  } else {
    parking = { text: "No parking info yet: be the first to report it", score: 1 };
  }

  // Live city sensor counts are about right now, so they only steer the pick when going now.
  const meters = state.meters[beach.id];
  if (meters && goingNow && !(useLive && live.parking)) {
    const share = meters.free / meters.total;
    parking = { ...parking, score: share >= 0.3 ? 3 : share >= 0.1 ? 2 : 0.5 };
  }

  return {
    beach,
    meters,
    live,
    useLive,
    crowd,
    est,
    weather,
    parking,
    // Lower is better: quieter, closer, easier to park.
    score: crowd + beach.distanceKm / 10 + (3 - parking.score) * 0.5,
  };
}

const SORTS = {
  best: (a, b) => a.score - b.score,
  distance: (a, b) => a.beach.distanceKm - b.beach.distanceKm,
  quiet: (a, b) => a.crowd - b.crowd || a.beach.distanceKm - b.beach.distanceKm,
  parking: (a, b) => b.parking.score - a.parking.score || a.beach.distanceKm - b.beach.distanceKm,
};

// --- Rendering -------------------------------------------------------------

function render() {
  const when = targetTime();
  const views = state.beaches.map((b) => describe(b, when)).sort(SORTS[$("sort").value]);
  const list = $("beaches");
  const openForm = list.querySelector(".report:not([hidden])");
  const openId = openForm && openForm.closest(".card").dataset.id;
  list.replaceChildren(...views.map((v) => card(v, v.beach.id === openId)));
  drawMap(views);
  $("shared-note").hidden = state.shared || demo;
}

function card(v, reportOpen) {
  const { beach, meters, live, useLive, crowd, est, weather, parking } = v;
  const node = $("beach-card").content.firstElementChild.cloneNode(true);
  const level = Math.min(5, Math.max(1, Math.round(crowd)));
  node.dataset.id = beach.id;
  node.classList.add(`level-${level}`);
  node.querySelector(".name").textContent = beach.name;
  node.querySelector(".away").textContent =
    `${fmtDistance(beach.distanceKm)} · ~${driveMinutes(beach.distanceKm)} min drive`;
  node.querySelector(".crowd-label").textContent = crowdLabel(crowd);
  node.querySelector(".meter").dataset.level = level;
  const tag = node.querySelector(".tag");
  tag.textContent = useLive ? "Live" : "Estimate";
  tag.classList.add(useLive ? "tag-live" : "tag-est");

  node.querySelector(".basis").textContent = useLive
    ? `${live.count} report${live.count > 1 ? "s" : ""} from beachgoers, newest ${ago(live.newest)}`
    : `No live reports${live && !useLive ? " for then" : ""}. Based on: ${est.reasons.join(" · ")}`;

  const facts = node.querySelector(".facts");
  facts.append(el("li", `Parking: ${parking.text}`));
  if (meters) {
    facts.append(el("li", `Street meters within ${imperial ? "½ mile" : "800 m"}: ${meters.free} of ${meters.total} free right now ` +
      `(City of LA sensors, updated ${ago(meters.newest)})`));
  }
  if (live && !useLive) facts.append(el("li", `Right now: ${crowdLabel(live.crowd)} (${live.count} live report${live.count > 1 ? "s" : ""})`));
  if (weather) {
    const bits = [fmtTemp(weather.tempC), `${Math.round(weather.precipProb || 0)}% rain`];
    if (weather.uv != null) bits.push(`UV ${Math.round(weather.uv)}`);
    facts.append(el("li", `Weather then: ${bits.join(", ")}`));
  }
  if (beach.lifeguards === "seasonal") facts.append(el("li", "Seasonal lifeguards"));
  else if (beach.lifeguard === "yes") facts.append(el("li", "Lifeguarded"));
  if (beach.dogArea) facts.append(el("li", "Has a dog area"));
  if (beach.noDogsOnBeach) facts.append(el("li", "No dogs on the beach"));
  if (beach.dogs === "yes" || beach.dogs === "leashed") facts.append(el("li", "Dogs allowed"));

  if (beach.curated) node.querySelector(".facts").after(lotList(beach));

  const notes = node.querySelector(".notes");
  for (const n of (live && live.notes) || []) notes.append(el("li", `“${n.note}” (${ago(n.time)})`));

  const dest = `${beach.lat},${beach.lon}`;
  node.querySelector(".directions").href =
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;

  buildReportForm(node, beach, reportOpen);
  return node;
}

// Every parking option for a hand-checked beach, each with a link to find it on a map.
function lotList(beach) {
  const details = el("details", null, "lots");
  details.append(el("summary", `Where to park (${beach.lots.length})`));
  const list = el("ul");
  for (const lot of beach.lots) {
    const li = el("li");
    const bits = [lot.spaces && `${lot.spaces} spaces`, lot.fee, lot.hours, lot.note].filter(Boolean);
    li.append(el("strong", lot.name), document.createTextNode(bits.length ? ` · ${bits.join(" · ")}` : ""));
    if (!lot.street) {
      const a = el("a", "map");
      a.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lot.name}, ${beach.name}, Santa Barbara County, CA`)}`;
      a.target = "_blank";
      a.rel = "noopener";
      li.append(document.createTextNode(" · "), a);
    }
    list.append(li);
  }
  details.append(list, el("p", "Rates and hours from the City of Santa Barbara, Santa Barbara County Parks and California State Parks. Check posted signs.", "fine"));
  return details;
}

function choice(name, value, label) {
  const wrap = el("label", null, "choice");
  const input = el("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  wrap.append(input, el("span", label));
  return wrap;
}

function buildReportForm(node, beach, open) {
  const form = node.querySelector(".report");
  const toggle = node.querySelector(".report-toggle");
  const uid = beach.id.replace(/\W/g, "-");
  form.querySelector(".crowd-choices").append(...CROWD_LABELS.map((label, i) => choice(`crowd-${uid}`, i + 1, label)));
  form.querySelector(".parking-choices").append(
    ...Object.entries(PARKING_LABELS).map(([value, label]) => choice(`parking-${uid}`, value, label)),
  );
  form.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.addEventListener("click", () => {
    form.hidden = !form.hidden;
    toggle.setAttribute("aria-expanded", String(!form.hidden));
  });

  const msg = form.querySelector(".report-msg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const crowd = form.querySelector(`input[name="crowd-${uid}"]:checked`);
    const parking = form.querySelector(`input[name="parking-${uid}"]:checked`);
    if (!crowd) return void (msg.textContent = "Pick how crowded it is.");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    msg.textContent = "Checking you're at the beach…";
    try {
      if (!demo) {
        const here = await currentPosition().catch(() => null);
        if (here && distanceKm(here, beach) > NEAR_BEACH_KM) {
          throw new Error(`You look to be ${fmtDistance(distanceKm(here, beach))} away. Please report from the beach.`);
        }
      }
      msg.textContent = "Sending…";
      const { shared } = await sendReport({
        beachId: beach.id,
        crowd: Number(crowd.value),
        parking: parking && parking.value,
        note: form.elements.note.value.trim(),
        slot: slotKey(new Date()),
      });
      state.shared = shared;
      form.hidden = true;
      await refreshReports();
      setStatus(`Thanks! Your report for ${beach.name} is ${shared ? "live for everyone" : "saved on this device"}.`);
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

const LEVEL_COLORS = ["#2a9d8f", "#57b36a", "#e9b949", "#f08a3c", "#d64545"];

function drawMap(views) {
  if (!window.L || !state.center) return;
  $("map").hidden = false;
  if (!map) {
    map = L.map("map", { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    markers = L.layerGroup().addTo(map);
  }
  markers.clearLayers();
  L.circleMarker([state.center.lat, state.center.lon], { radius: 6, color: "#1d4ed8", fillOpacity: 1 })
    .bindTooltip("You")
    .addTo(markers);
  for (const v of views) {
    const level = Math.min(5, Math.max(1, Math.round(v.crowd)));
    const popup = el("div");
    popup.append(el("strong", v.beach.name), el("br"), document.createTextNode(
      `${crowdLabel(v.crowd)} (${v.useLive ? "live" : "estimate"})`,
    ));
    L.circleMarker([v.beach.lat, v.beach.lon], {
      radius: 10, color: "#fff", weight: 2, fillColor: LEVEL_COLORS[level - 1], fillOpacity: 0.95,
    })
      .bindPopup(popup)
      .on("click", () => {
        const target = document.querySelector(`.card[data-id="${CSS.escape(v.beach.id)}"]`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      })
      .addTo(markers);
  }
  const points = [[state.center.lat, state.center.lon], ...views.map((v) => [v.beach.lat, v.beach.lon])];
  map.fitBounds(points, { padding: [24, 24], maxZoom: 14 });
  map.invalidateSize();
}

// --- Loading ---------------------------------------------------------------

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Your browser can't share your location. Search for a town instead."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error("Couldn't get your location. Search for a town instead.")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

async function refreshReports() {
  if (!state.beaches.length) return;
  const got = await getReports(state.beaches.map((b) => b.id));
  state.shared = got.shared;
  state.reports = got.reports;
  state.history = got.history;
  if (demo) {
    const seeded = demoReports();
    for (const [id, list] of Object.entries(seeded)) state.reports[id] = [...(state.reports[id] || []), ...list];
    for (const [id, h] of Object.entries(DEMO_HISTORY)) state.history[id] = { ...h, ...state.history[id] };
  }
  render();
}

// Live street-meter counts, where the city publishes them. Optional: failures just hide the line.
async function refreshMeters() {
  const beaches = state.beaches;
  try {
    const meters = await getMeters(beaches);
    if (beaches !== state.beaches) return; // a newer search replaced these beaches
    state.meters = meters;
    if (Object.keys(meters).length) render();
  } catch {
    state.meters = {};
  }
}

function beachesStatus(radius, center) {
  return `${state.beaches.length} beaches within ${fmtDistance(radius)} of ${center.label}.`;
}

async function load(center) {
  state.center = center;
  state.meters = {};
  setStatus(`Finding beaches near ${center.label}…`);
  let radius = Number($("radius").value);
  state.weather = null;
  // Weather fills in when it arrives; it never holds up the list.
  getWeather(center)
    .then((w) => {
      if (state.center !== center) return;
      state.weather = w;
      if (state.beaches.length) {
        render();
        setStatus(beachesStatus(radius, center));
      }
    })
    .catch(() => {});

  // Around Santa Barbara, show the hand-checked beaches right away, then add any other mapped
  // beaches once the (slower) map lookup answers.
  if (!demo && inSantaBarbara(center)) {
    state.beaches = sbBeaches(center, radius);
    $("plan").hidden = false;
    await refreshReports();
    setStatus(beachesStatus(radius, center));
    findBeaches(center, radius)
      .then(async (found) => {
        if (state.center !== center) return; // a newer search took over
        state.beaches = mergeWithCurated(state.beaches.filter((b) => b.curated), found);
        await refreshReports();
        setStatus(beachesStatus(radius, center));
      })
      .catch(() => {}); // the hand-checked list is already showing
    return;
  }

  const lookup = (km) => (demo
    ? Promise.resolve(DEMO_BEACHES.map((b) => ({ ...b, distanceKm: distanceKm(center, b) })).filter((b) => b.distanceKm <= km))
    : findBeaches(center, km)
      .then((found) => mergeWithCurated(sbBeaches(center, km), found))
      .catch((err) => {
        const curated = sbBeaches(center, km);
        if (curated.length) return curated;
        throw err;
      }));
  let beaches;
  try {
    beaches = await lookup(radius);
    // Inland towns are often a little further from the coast than the default radius.
    const widest = Number($("radius").options[$("radius").options.length - 1].value);
    if (!beaches.length && radius < widest) {
      setStatus(`No beaches within ${fmtDistance(radius)}, looking further…`);
      radius = widest;
      $("radius").value = String(widest);
      beaches = await lookup(radius);
    }
  } catch (err) {
    setStatus(`${err.message}. Try again in a minute.`, true);
    return;
  }
  if (state.center !== center) return;
  state.beaches = beaches;
  $("plan").hidden = false;
  if (!state.beaches.length) {
    $("beaches").replaceChildren();
    $("map").hidden = true;
    setStatus(`No named beaches within ${fmtDistance(radius)} of ${center.label}.`);
    return;
  }
  await refreshReports();
  refreshMeters();
  setStatus(beachesStatus(radius, center));
}

$("near-me").addEventListener("click", async () => {
  setStatus("Getting your location…");
  try {
    const pos = await currentPosition();
    await load({ ...pos, label: "you" });
  } catch (err) {
    setStatus(err.message, true);
  }
});

$("where").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("place").value.trim();
  if (!text) return;
  setStatus(`Looking up ${text}…`);
  try {
    await load(await geocode(text));
  } catch (err) {
    setStatus(err.message, true);
  }
});

// Show the distance menu in the visitor's units.
for (const opt of $("radius").options) opt.textContent = fmtDistance(Number(opt.value)).replace(/\.0 /, " ");

$("when").addEventListener("change", render);
$("sort").addEventListener("change", render);
$("radius").addEventListener("change", () => state.center && load(state.center));

// Keep live reports fresh while the page is open.
setInterval(() => {
  // Don't rebuild the list under someone halfway through a report.
  const reporting = document.querySelector(".report:not([hidden])");
  if (document.visibilityState === "visible" && !reporting) {
    refreshReports().catch(() => {});
    refreshMeters();
  }
}, REFRESH_MS);

// Start on Santa Barbara; "Use my location" or a search looks elsewhere.
load(demo ? DEMO_CENTER : SB_CENTER);
