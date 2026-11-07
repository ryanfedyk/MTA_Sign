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

/** Merge OneBusAway timetable + SIRI live GPS into a sorted list of {min, live}. */
function parseBus(oba, siri, nowMs) {
  const arrivalsMap = new Map();
  let obaCount = 0;

  if (oba?.data) {
    const serverTime = oba.currentTime || nowMs;
    const list = oba.data.arrivalsAndDepartures || oba.data.entry?.arrivalsAndDepartures || [];
    obaCount = list.length;

    for (const item of list) {
      const route = item.routeShortName || item.routeId || "";
      if (route && !route.includes("B48")) continue;

      // A bus is live ONLY if predicted is explicitly true and predictedArrivalTime > 0
      const isLive = Boolean(item.predicted) && Boolean(item.predictedArrivalTime && item.predictedArrivalTime > 0);
      const targetMs = (isLive && item.predictedArrivalTime)
        ? item.predictedArrivalTime
        : (item.scheduledArrivalTime || item.scheduledDepartureTime);
      if (!targetMs) continue;

      const diffMs = targetMs - serverTime;
      let mins = -1;
      if (diffMs >= 45000) mins = Math.floor(diffMs / 60000);
      else if (diffMs >= -90000) mins = 0;

      if (mins >= 0) {
        const existing = arrivalsMap.get(mins);
        if (!existing || isLive) arrivalsMap.set(mins, { min: mins, live: isLive });
      }
    }
  }

  // Secondary pass: mark/insert vehicles SIRI confirms are tracked by GPS
  const visits = siri?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];
  for (const visit of visits) {
    const journey = visit.MonitoredVehicleJourney || {};
    const call = journey.MonitoredCall || {};
    const expTime = call.ExpectedArrivalTime || call.ExpectedDepartureTime;
    const status = journey.ProgressStatus || "";

    const isLive = Boolean(journey.VehicleRef) && Boolean(expTime) && !status.includes("layover");
    const chosenTime = expTime || call.AimedArrivalTime || call.AimedDepartureTime;
    let mins = -1;
    if (chosenTime) {
      const diffSec = Math.floor((new Date(chosenTime).getTime() - nowMs) / 1000);
      if (diffSec >= 45) mins = Math.floor(diffSec / 60);
      else if (diffSec >= -120) mins = 0;
    }

    if (mins >= 0 && isLive) {
      const existing = arrivalsMap.get(mins) || arrivalsMap.get(mins - 1) || arrivalsMap.get(mins + 1);
      if (existing) existing.live = true;
      else arrivalsMap.set(mins, { min: mins, live: true });
    }
  }

  return { arrivals: Array.from(arrivalsMap.values()).sort((a, b) => a.min - b.min), obaCount };
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
    getJson(L_FEED),
    wantBus
      ? getJson(`https://bustime.mta.info/api/where/arrivals-and-departures-for-stop/MTA_${plan.b.stop}.json?key=${busKey}&minutesAfter=120`)
      : Promise.resolve(null),
    wantBus
      ? getJson(`https://bustime.mta.info/api/siri/stop-monitoring.json?key=${busKey}&MonitoringRef=${plan.b.stop}&StopMonitoringDetailLevel=calls&MaximumStopVisits=8`)
      : Promise.resolve(null),
  ]);
  const value = (r) => (r.status === "fulfilled" ? r.value : null);

  const l = parseL(value(lRes), plan.l.track, nowMs);
  const bus = parseBus(value(obaRes), value(siriRes), nowMs);
  const a = bus.arrivals;

  const response = {
    lay: plan.layout,
    l: { dir: plan.l.label, t1: l.t1, t2: l.t2 },
    // Always present (blank on weekends) so older firmware never misreads it.
    b: {
      dir: plan.b ? plan.b.label : "",
      t1: a[0] ? a[0].min : -1, live1: a[0] ? a[0].live : true,
      t2: a[1] ? a[1].min : -1, live2: a[1] ? a[1].live : true,
    },
  };
  if (debug) {
    response.debug = { plan, obaArrivalsCount: bus.obaCount, totalMerged: a.length, allMergedArrivals: a };
  }
  return response;
}

module.exports = { parseL, parseBus, buildArrivals };
