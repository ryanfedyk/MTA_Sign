const { onRequest } = require("firebase-functions/v2/https");

// MTA Bus Time API key. Never hard-code it here (this repo is public).
// At deploy time GitHub Actions writes it into functions/.env from the
// MTA_BUS_KEY repository secret; Firebase loads that file into process.env.
const MTA_BUS_KEY = process.env.MTA_BUS_KEY;
const B48_STOP_SB = "303855"; // Lorimer St / Metropolitan Ave (Southbound)
const B48_STOP_NB = "303825"; // Lorimer St / Grand St (Northbound dismissal)

exports.transit = onRequest({ cors: true, memory: "256MiB", timeoutSeconds: 15 }, async (req, res) => {
  try {
    if (!MTA_BUS_KEY) {
      // L train still works; the bus row will show "--" until the key is set.
      console.error("MTA_BUS_KEY is not configured; B48 data unavailable");
    }
    const nowUtc = new Date();
    const etString = nowUtc.toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(etString);
    const hour = etDate.getHours();
    const day = etDate.getDay();

    // L Train Direction: Weekdays 4-7 PM = Brooklyn (BK), otherwise Manhattan (MN)
    let lDir = (day !== 0 && day !== 6 && hour >= 16 && hour < 19) ? "S" : "N";
    let lLabel = (day !== 0 && day !== 6 && hour >= 16 && hour < 19) ? "BK" : "MN";

    // B48 Direction: Afternoons (12 PM – 7 PM) = NB, otherwise SB
    let b48Stop = (hour >= 12 && hour < 19) ? B48_STOP_NB : B48_STOP_SB;
    let b48Label = (hour >= 12 && hour < 19) ? "NB" : "SB";

    if (req.query.dir === "NB") {
      b48Stop = B48_STOP_NB;
      b48Label = "NB";
    } else if (req.query.dir === "SB") {
      b48Stop = B48_STOP_SB;
      b48Label = "SB";
    }

    const obaStopId = `MTA_${b48Stop}`;

    const [lRes, obaRes, siriRes] = await Promise.allSettled([
      fetch("https://api.wheresthefuckingtrain.com/by-route/L").then(r => r.json()),
      fetch(
        `https://bustime.mta.info/api/where/arrivals-and-departures-for-stop/${obaStopId}.json?key=${MTA_BUS_KEY}&minutesAfter=120`
      ).then(r => r.json()),
      fetch(
        `https://bustime.mta.info/api/siri/stop-monitoring.json?key=${MTA_BUS_KEY}&MonitoringRef=${b48Stop}&StopMonitoringDetailLevel=calls&MaximumStopVisits=8`
      ).then(r => r.json())
    ]);

    // 1. Parse L Train
    let l_t1 = -1, l_t2 = -1;
    if (lRes.status === "fulfilled" && lRes.value?.data) {
      const station = lRes.value.data.find(
        st => (st.id && (st.id.includes("G29") || st.id.includes("L10"))) || (st.name && st.name.includes("Lorimer"))
      );
      if (station && station[lDir]) {
        for (const tr of station[lDir]) {
          if (!tr.time) continue;
          const diffSec = Math.floor((new Date(tr.time).getTime() - nowUtc.getTime()) / 1000);
          if (diffSec >= 45) {
            const mins = Math.floor(diffSec / 60);
            if (l_t1 === -1) l_t1 = mins;
            else if (l_t2 === -1 && mins > l_t1) {
              l_t2 = mins;
              break;
            }
          } else if (diffSec >= 0 && l_t1 === -1) {
            l_t1 = 0;
          }
        }
      }
    }

    // 2. Parse B48 Arrivals (OneBusAway Timetable + SIRI Live Merge)
    const arrivalsMap = new Map();
    let obaCount = 0;

    if (obaRes.status === "fulfilled" && obaRes.value?.data) {
      const serverTime = obaRes.value.currentTime || Date.now();
      // Directly check data.arrivalsAndDepartures or fallback to data.entry
      const list = obaRes.value.data.arrivalsAndDepartures || obaRes.value.data.entry?.arrivalsAndDepartures || [];
      obaCount = list.length;

      for (const item of list) {
        const route = item.routeShortName || item.routeId || "";
        if (route && !route.includes("B48")) continue;

        // A bus is live ONLY if predicted is explicitly true and predictedArrivalTime > 0
        const isLive = Boolean(item.predicted) && Boolean(item.predictedArrivalTime && item.predictedArrivalTime > 0);
        let targetMs = (isLive && item.predictedArrivalTime)
          ? item.predictedArrivalTime
          : (item.scheduledArrivalTime || item.scheduledDepartureTime);

        if (!targetMs) continue;

        const diffMs = targetMs - serverTime;
        let mins = -1;
        if (diffMs >= 45000) {
          mins = Math.floor(diffMs / 60000);
        } else if (diffMs >= -90000) {
          mins = 0;
        }

        if (mins >= 0) {
          const existing = arrivalsMap.get(mins);
          if (!existing || isLive) {
            arrivalsMap.set(mins, { min: mins, live: isLive });
          }
        }
      }
    }

    // Secondary pass: Merge active SIRI visits if GPS tracking is confirmed
    if (siriRes.status === "fulfilled") {
      const visits =
        siriRes.value?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];

      for (const visit of visits) {
        const journey = visit.MonitoredVehicleJourney || {};
        const call = journey.MonitoredCall || {};
        const vehicleRef = journey.VehicleRef;
        const expTime = call.ExpectedArrivalTime || call.ExpectedDepartureTime;
        const status = journey.ProgressStatus || "";

        // Only mark live if actively in-service with an assigned GPS transponder
        const isLive = Boolean(vehicleRef) && Boolean(expTime) && !status.includes("layover");
        const chosenTime = expTime || call.AimedArrivalTime || call.AimedDepartureTime;
        let mins = -1;

        if (chosenTime) {
          const diffSec = Math.floor((new Date(chosenTime).getTime() - nowUtc.getTime()) / 1000);
          if (diffSec >= 45) {
            mins = Math.floor(diffSec / 60);
          } else if (diffSec >= -120) {
            mins = 0;
          }
        }

        if (mins >= 0 && isLive) {
          const existing = arrivalsMap.get(mins) || arrivalsMap.get(mins - 1) || arrivalsMap.get(mins + 1);
          if (existing) {
            existing.live = true;
          } else {
            arrivalsMap.set(mins, { min: mins, live: true });
          }
        }
      }
    }

    const sortedArrivals = Array.from(arrivalsMap.values()).sort((a, b) => a.min - b.min);

    let b_t1 = -1, b_live1 = true;
    let b_t2 = -1, b_live2 = true;

    if (sortedArrivals.length > 0) {
      b_t1 = sortedArrivals[0].min;
      b_live1 = sortedArrivals[0].live;
    }
    if (sortedArrivals.length > 1) {
      b_t2 = sortedArrivals[1].min;
      b_live2 = sortedArrivals[1].live;
    }

    const response = {
      l: { dir: lLabel, t1: l_t1, t2: l_t2 },
      b: { dir: b48Label, t1: b_t1, live1: b_live1, t2: b_t2, live2: b_live2 }
    };

    if (req.query.debug === "1") {
      response.debug = {
        obaArrivalsCount: obaCount,
        totalMerged: sortedArrivals.length,
        allMergedArrivals: sortedArrivals
      };
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});