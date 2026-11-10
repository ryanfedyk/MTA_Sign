// Service alerts (delays, suspensions, planned work) from the MTA's official
// GTFS-realtime alert feeds, reduced to one short status per route:
//   { level: 0 | 1 | 2, label: "" | "Delays" | "Changes" | "Planned" | "Suspended" }
// level 1 = amber (delays, reroutes, service changes, planned work)
// level 2 = red   (no service / suspended)

const FEEDS = {
  subway: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json",
  bus: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fbus-alerts.json",
};

const NONE = Object.freeze({ level: 0, label: "" });

// Protobuf-to-JSON can produce snake_case or camelCase; accept both.
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined) return o[k]; return undefined; };
const text = (t) => {
  const tr = pick(t, "translation") || [];
  const en = tr.find((x) => !x.language || /^en/i.test(x.language)) || tr[0];
  return (en && en.text) || "";
};

function isActive(alert, nowSec) {
  const periods = pick(alert, "active_period", "activePeriod") || [];
  if (!periods.length) return true;
  return periods.some((p) => {
    const start = Number(pick(p, "start") || 0), end = Number(pick(p, "end") || 0);
    return (!start || start <= nowSec) && (!end || end >= nowSec);
  });
}

/** Turns one alert into {level, label}. */
function classify(alert) {
  const merc = pick(alert, "transit_realtime.mercury_alert", "mercuryAlert", "mercury_alert") || {};
  const type = String(pick(merc, "alert_type", "alertType") || "");
  const header = text(pick(alert, "header_text", "headerText"));
  const s = `${type} ${header}`.toLowerCase();
  if (/no (scheduled )?(train|service)|suspend|not running|no trains/.test(s)) return { level: 2, label: "Suspended" };
  if (/delay/.test(s)) return { level: 1, label: "Delays" };
  if (/planned|weekend|overnight|night/.test(type.toLowerCase())) return { level: 1, label: "Planned" };
  if (/reroute|detour|change|express|local|skip|bypass|board|stop/.test(s)) return { level: 1, label: "Changes" };
  return { level: 1, label: "Changes" };
}

/**
 * Worst current status for each route we care about.
 * @param {object} subwayFeed  parsed subway alerts JSON (may be null)
 * @param {object} busFeed     parsed bus alerts JSON (may be null)
 * @returns {{L: {level,label,headline}, B48: {level,label,headline}}}
 */
function summarize(subwayFeed, busFeed, nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000);
  const out = { L: { ...NONE, headline: "" }, B48: { ...NONE, headline: "" } };
  const scan = (feed, key, matches) => {
    for (const e of (feed && feed.entity) || []) {
      const a = e.alert;
      if (!a || !isActive(a, nowSec)) continue;
      const ents = pick(a, "informed_entity", "informedEntity") || [];
      if (!ents.some((ie) => matches(String(pick(ie, "route_id", "routeId") || "")))) continue;
      const c = classify(a);
      // Planned work only counts while it's actually in effect (isActive above);
      // keep the most severe status.
      if (c.level > out[key].level || (c.level === out[key].level && out[key].label === "Planned" && c.label !== "Planned")) {
        out[key] = { ...c, headline: text(pick(a, "header_text", "headerText")).slice(0, 200) };
      }
    }
  };
  scan(subwayFeed, "L", (r) => r === "L");
  scan(busFeed, "B48", (r) => /(^|[_ ])B48$/.test(r) || r === "B48");
  return out;
}

// Cached per server instance: the feeds change slowly and are fairly large.
let cache = { at: 0, value: null };
async function currentAlerts({ fetchImpl = fetch, apiKey = process.env.MTA_API_KEY, maxAgeMs = 60000, nowMs = Date.now() } = {}) {
  if (cache.value && nowMs - cache.at < maxAgeMs) return cache.value;
  const get = (url) => fetchImpl(url, { headers: apiKey ? { "x-api-key": apiKey } : {} })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [subway, bus] = await Promise.all([get(FEEDS.subway), get(FEEDS.bus)]);
  const value = summarize(subway, bus, nowMs);
  value.ok = Boolean(subway || bus);
  cache = { at: nowMs, value };
  return value;
}
function clearCache() { cache = { at: 0, value: null }; }

module.exports = { FEEDS, summarize, classify, currentAlerts, clearCache, NONE };
