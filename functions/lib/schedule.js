// What the sign shows when -- an editable list of time blocks (New York time).
//
// Each block: { days: [0..6] (0 = Sunday), from: minutes, to: minutes,
//               L: "MN" | "BK" | "off",  B48: "NB" | "SB" | "off" }
// Blocks are checked top to bottom; the first one that matches wins.
// A block whose "to" is earlier than its "from" wraps past midnight.
// Outside every block the sign shows the L to Manhattan only.
//
// Layout follows from what's on: both routes -> two rows ("LB"); one route ->
// that route full screen ("L" or "B"); nothing -> blank sign ("off").

const TZ = "America/New_York";
const B48_STOP_SB = "303855"; // Lorimer St / Metropolitan Ave (Southbound)
const B48_STOP_NB = "303825"; // Lorimer St / Grand St (Northbound, school dismissal)

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const L_CHOICES = ["MN", "BK", "off"];
const B_CHOICES = ["NB", "SB", "off"];
const MAX_BLOCKS = 24;

// The original rules, as blocks.
const DEFAULT_BLOCKS = [
  { days: [1, 2, 3, 4, 5], from: 0, to: 12 * 60, L: "MN", B48: "SB" },
  { days: [1, 2, 3, 4, 5], from: 12 * 60, to: 16 * 60, L: "MN", B48: "NB" },
  { days: [1, 2, 3, 4, 5], from: 16 * 60, to: 19 * 60, L: "BK", B48: "NB" },
  { days: [1, 2, 3, 4, 5], from: 19 * 60, to: 24 * 60, L: "MN", B48: "SB" },
  { days: [0, 6], from: 0, to: 24 * 60, L: "MN", B48: "off" },
];
const FALLBACK = { L: "MN", B48: "off" };

function localTime(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: WEEKDAYS[get("weekday")], hour: Number(get("hour")), minute: Number(get("minute")) };
}

function inBlock(b, day, minute) {
  if (b.from <= b.to) return b.days.includes(day) && minute >= b.from && minute < b.to;
  // wraps past midnight: the late part belongs to the listed day, the early part to the next day
  if (minute >= b.from) return b.days.includes(day);
  return minute < b.to && b.days.includes((day + 6) % 7);
}

/** Validates blocks from the app. Throws with a readable message. */
function validateBlocks(blocks) {
  if (!Array.isArray(blocks)) throw new Error("schedule must be a list of blocks");
  if (blocks.length > MAX_BLOCKS) throw new Error(`at most ${MAX_BLOCKS} blocks`);
  return blocks.map((b, i) => {
    const days = [...new Set((b?.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!days.length) throw new Error(`block ${i + 1} has no days`);
    const mins = (v, name) => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 1440) throw new Error(`block ${i + 1}: bad ${name} time`);
      return n;
    };
    const from = mins(b.from, "start"), to = mins(b.to, "end");
    if (from === to) throw new Error(`block ${i + 1} starts and ends at the same time`);
    if (!L_CHOICES.includes(b.L)) throw new Error(`block ${i + 1}: L must be MN, BK or off`);
    if (!B_CHOICES.includes(b.B48)) throw new Error(`block ${i + 1}: B48 must be NB, SB or off`);
    return { days, from, to, L: b.L, B48: b.B48 };
  });
}

/**
 * @param {Date} date
 * @param {{busDir?: "NB"|"SB"}} [overrides]  ?dir= query param for testing
 * @param {Array} [blocks]  the saved schedule (defaults to the original rules)
 * @returns {{layout: "LB"|"L"|"B"|"off", weekend: boolean,
 *            l: null | {track: "N"|"S", label: string},
 *            b: null | {stop: string, label: string}}}
 */
function planFor(date, overrides = {}, blocks = DEFAULT_BLOCKS) {
  const { day, hour, minute } = localTime(date);
  const m = hour * 60 + minute;
  const block = (blocks && blocks.length ? blocks : DEFAULT_BLOCKS).find((b) => inBlock(b, day, m)) || FALLBACK;

  const l = block.L === "off" ? null : block.L === "BK" ? { track: "S", label: "BK" } : { track: "N", label: "MN" };
  let b = block.B48 === "off" ? null : block.B48 === "NB" ? { stop: B48_STOP_NB, label: "NB" } : { stop: B48_STOP_SB, label: "SB" };
  if (overrides.busDir === "NB") b = { stop: B48_STOP_NB, label: "NB" };
  if (overrides.busDir === "SB") b = { stop: B48_STOP_SB, label: "SB" };

  const layout = l && b ? "LB" : l ? "L" : b ? "B" : "off";
  return { layout, weekend: day === 0 || day === 6, l, b };
}

/** Plain-English description for the app ("L to Manhattan + B48 northbound"). */
function describePlan(p) {
  const parts = [];
  if (p.l) parts.push(`L to ${p.l.label === "BK" ? "Brooklyn" : "Manhattan"}`);
  if (p.b) parts.push(`B48 ${p.b.label === "NB" ? "northbound" : "southbound"}`);
  return parts.length ? parts.join(" + ") : "Nothing (sign is blank)";
}

module.exports = { planFor, localTime, validateBlocks, describePlan, DEFAULT_BLOCKS, B48_STOP_NB, B48_STOP_SB };
