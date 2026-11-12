// Fetches and merges live arrivals. Parsing logic is unchanged from the
// original sign; it's just split into functions so it can be tested and so
// the bus feeds are skipped when the schedule doesn't need them (weekends).

const L_FEED = "https://api.wheresthefuckingtrain.com/by-route/L";

/** Next two L trains (minutes) at Lorimer St on the given track ("N" or "S"). */
function parseL(feed, track, nowMs) {
  let t1 = -1, t2 = -1;
  if (!feed?.data) return { t1, t2 };
  const station = feed.data.find(
    (st) => (st.id && (st.id.includes("G29") || st.id.includes("L10"))) || (st.name && st.name.includes("Lorimer"))
  );
  if (!station || !station[track]) return { t1, t2 };
  for (const tr of station[track]) {
    if (!tr.time) continue;
    const diffSec = Math.floor((new Date(tr.time).getTime() - nowMs) / 1000);
    if (diffSec >= 45) {
      const mins = Math.floor(diffSec / 60);
      if (t1 === -1) t1 = mins;
      else if (t2 === -1 && mins > t1) {
        t2 = mins;
        break;
      }
    } else if (diffSec >= 0 && t1 === -1) {
      t1 = 0;
    }
  }
  return { t1, t2 };
}

/**
 * Merge OneBusAway (timetable) + SIRI (live vehicles) into a sorted list of
 * {min, live}, one entry per trip.
 *
 * What the MTA feeds actually do (checked against live data):
 *  - SIRI lists every trip that has a bus assigned -- including buses waiting
 *    at the terminal ("layover") or still finishing their previous run
 *    ("prevTrip"). Those still carry an ExpectedArrivalTime when the MTA can
 *    predict them, and other apps show them as live.
 *  - OneBusAway lists trips with *no* bus assigned yet (scheduled only).
 * So trips are matched by trip id; a trip is "live" whenever there's a real
 * prediction, and an assigned bus without one falls back to its schedule
 * instead of disappearing.
 */
function parseBus(oba, siri, nowMs) {
  const trips = new Map();   // tripId -> { ms, live }
  let obaCount = 0, anon = 0;
  const put = (trip, ms, live) => {
    const key = trip || `anon-${anon++}`;
    const prev = trips.get(key);
    if (!prev || (live && !prev.live)) trips.set(key, { ms, live });
  };

  // 1. Live vehicles (SIRI)
  const visits = siri?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];
  for (const visit of visits) {
    const journey = visit.MonitoredVehicleJourney || {};
    const route = String(journey.PublishedLineName || journey.LineRef || "");
    if (route && !route.includes("B48")) continue;
    const call = journey.MonitoredCall || {};
    const expected = Date.parse(call.ExpectedArrivalTime || call.ExpectedDepartureTime || "");
    const aimed = Date.parse(call.AimedArrivalTime || call.AimedDepartureTime || "");
    const trip = journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef;
    if (Number.isFinite(expected) && journey.VehicleRef) put(trip, expected, true);
    else if (Number.isFinite(aimed)) put(trip, aimed, false);
  }

  // 2. Timetable (OneBusAway): scheduled trips, plus any predictions it has
  if (oba?.data) {
    const offset = (oba.currentTime || nowMs) - nowMs;   // OBA times are relative to its own clock
    const list = oba.data.arrivalsAndDepartures || oba.data.entry?.arrivalsAndDepartures || [];
    obaCount = list.length;
    for (const item of list) {
      const route = item.routeShortName || item.routeId || "";
      if (route && !route.includes("B48")) continue;
      const predicted = Boolean(item.predicted) && item.predictedArrivalTime > 0;
      const t = predicted ? item.predictedArrivalTime : (item.scheduledArrivalTime || item.scheduledDepartureTime);
      if (t) put(item.tripId, t - offset, predicted);
    }
  }

  // 3. Minutes away (arriving now = 0); drop buses that have already gone
  const arrivals = [];
  for (const { ms, live } of trips.values()) {
    const diff = ms - nowMs;
    if (diff >= 45000) arrivals.push({ min: Math.floor(diff / 60000), live });
    else if (diff >= -90000) arrivals.push({ min: 0, live });
  }
  arrivals.sort((x, y) => x.min - y.min || Number(y.live) - Number(x.live));
  return { arrivals, obaCount };
}

// Trimmed view of both bus feeds, for diagnosing mismatches with other apps.
function rawBus(oba, siri, nowMs) {
  const min = (t) => (t ? Math.round((t - nowMs) / 6000) / 10 : null);
  const list = oba?.data?.arrivalsAndDepartures || oba?.data?.entry?.arrivalsAndDepartures || [];
  const visits = siri?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];
  return {
    oba: list.map((i) => ({
      route: i.routeShortName, trip: i.tripId, vehicle: i.vehicleId || null, predicted: i.predicted,
      predMin: min(i.predictedArrivalTime || i.predictedDepartureTime), schedMin: min(i.scheduledArrivalTime || i.scheduledDepartureTime),
      stopsAway: i.numberOfStopsAway, status: i.tripStatus?.status, phase: i.tripStatus?.phase,
    })),
    siri: visits.map((v) => {
      const j = v.MonitoredVehicleJourney || {}, c = j.MonitoredCall || {};
      return {
        trip: j.FramedVehicleJourneyRef?.DatedVehicleJourneyRef, vehicle: j.VehicleRef, progress: j.ProgressStatus || null,
        expMin: min(Date.parse(c.ExpectedArrivalTime || c.ExpectedDepartureTime || "") || 0),
        aimedMin: min(Date.parse(c.AimedArrivalTime || c.AimedDepartureTime || "") || 0),
        away: c.Extensions?.Distances?.PresentableDistance || null,
      };
    }),
  };
}

const getJson = (url) => fetch(url).then((r) => r.json());

/**
 * Build the compact payload the ESP32 reads.
 * @param {ReturnType<import("./schedule").planFor>} plan
 */
async function buildArrivals(plan, { busKey, now = new Date(), debug = false } = {}) {
  const nowMs = now.getTime();
  const wantBus = Boolean(plan.b) && Boolean(busKey);

  const [lRes, obaRes, siriRes] = await Promise.allSettled([
    plan.l ? getJson(L_FEED) : Promise.resolve(null),
    wantBus
      ? getJson(`https://bustime.mta.info/api/where/arrivals-and-departures-for-stop/MTA_${plan.b.stop}.json?key=${busKey}&minutesAfter=120`)
      : Promise.resolve(null),
    wantBus
      ? getJson(`https://bustime.mta.info/api/siri/stop-monitoring.json?key=${busKey}&MonitoringRef=${plan.b.stop}&StopMonitoringDetailLevel=calls&MaximumStopVisits=8`)
      : Promise.resolve(null),
  ]);
  const value = (r) => (r.status === "fulfilled" ? r.value : null);

  const l = plan.l ? parseL(value(lRes), plan.l.track, nowMs) : { t1: -1, t2: -1 };
  const bus = parseBus(value(obaRes), value(siriRes), nowMs);
  const a = bus.arrivals;

  const response = {
    lay: plan.layout,
    l: { dir: plan.l ? plan.l.label : "", t1: l.t1, t2: l.t2 },
    // Always present (blank on weekends) so older firmware never misreads it.
    b: {
      dir: plan.b ? plan.b.label : "",
      t1: a[0] ? a[0].min : -1, live1: a[0] ? a[0].live : true,
      t2: a[1] ? a[1].min : -1, live2: a[1] ? a[1].live : true,
    },
  };
  // Service problems for the routes this block watches (shown as indicators).
  const al = plan.alerts || {};
  for (const [key, short] of [["L", "l"], ["B48", "b"]]) {
    const a = al[key];
    if (plan.watch && plan.watch[key] && a && a.level > 0) {
      response[short + "a"] = a.label;     // "Delays" | "Changes" | "Planned" | "Suspended"
      response[short + "s"] = a.level;     // 1 amber, 2 red
    }
  }
  if (debug) {
    response.debug = { plan: { ...plan, alerts: undefined }, alerts: al, obaArrivalsCount: bus.obaCount, totalMerged: a.length, allMergedArrivals: a };
    if (debug === "raw") response.debug.raw = rawBus(value(obaRes), value(siriRes), nowMs);
  }
  return response;
}

module.exports = { parseL, parseBus, buildArrivals };
