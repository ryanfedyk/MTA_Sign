// What the sign should show at a given moment (all times New York local).
//
// Weekdays
//   L train : Brooklyn-bound (BK) 4–7 PM, otherwise Manhattan-bound (MN)
//   B48 bus : Northbound (NB, stop 303825) 12–7 PM, otherwise Southbound (SB, stop 303855)
// Weekends
//   L train to Manhattan only, full-screen layout. No bus.

const TZ = "America/New_York";
const B48_STOP_SB = "303855"; // Lorimer St / Metropolitan Ave (Southbound)
const B48_STOP_NB = "303825"; // Lorimer St / Grand St (Northbound, school dismissal)

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localTime(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: WEEKDAYS[get("weekday")], hour: Number(get("hour")), minute: Number(get("minute")) };
}

/**
 * @param {Date} date
 * @param {{busDir?: "NB"|"SB"}} [overrides]  ?dir= query param for testing
 * @returns {{layout: "L"|"LB", weekend: boolean,
 *            l: {track: "N"|"S", label: string},
 *            b: null | {stop: string, label: string}}}
 */
function planFor(date, overrides = {}) {
  const { day, hour } = localTime(date);
  const weekend = day === 0 || day === 6;

  const evening = !weekend && hour >= 16 && hour < 19;
  const l = evening ? { track: "S", label: "BK" } : { track: "N", label: "MN" };

  let b = null;
  if (!weekend) {
    const afternoon = hour >= 12 && hour < 19;
    b = afternoon ? { stop: B48_STOP_NB, label: "NB" } : { stop: B48_STOP_SB, label: "SB" };
  }
  if (overrides.busDir === "NB") b = { stop: B48_STOP_NB, label: "NB" };
  if (overrides.busDir === "SB") b = { stop: B48_STOP_SB, label: "SB" };

  return { layout: b ? "LB" : "L", weekend, l, b };
}

module.exports = { planFor, localTime, B48_STOP_NB, B48_STOP_SB };
