// Serves a Firebase HTTP function on a local port and calls it over real HTTP
// (node:http, so a faked global fetch never intercepts the call itself).
const http = require("node:http");

function call(handler, { method = "GET", path = "/", query = {}, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const url = new URL(req.url, "http://x");
        req.query = Object.fromEntries(url.searchParams);
        req.body = raw ? JSON.parse(raw) : {};
        req.get = (h) => req.headers[h.toLowerCase()];
        res.status = (c) => { res.statusCode = c; return res; };
        res.set = (k, v) => { res.setHeader(k, v); return res; };
        res.send = (b) => res.end(b);
        res.json = (b) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(b)); };
        handler(req, res);
      });
    });
    server.listen(0, () => {
      const qs = new URLSearchParams(query).toString();
      const data = body === undefined ? null : JSON.stringify(body);
      const req = http.request(
        { host: "127.0.0.1", port: server.address().port, method, path: path + (qs ? "?" + qs : ""),
          headers: { ...headers, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
        (res) => {
          let out = "";
          res.on("data", (d) => (out += d));
          res.on("end", () => {
            server.close();
            let parsed = out;
            try { parsed = JSON.parse(out); } catch { /* html */ }
            resolve({ status: res.statusCode, body: parsed, headers: res.headers });
          });
        });
      req.on("error", (e) => { server.close(); reject(e); });
      if (data) req.write(data);
      req.end();
    });
  });
}

/** Fake MTA feeds, relative to `now` (ms). Records which URLs were requested. */
function fakeFeeds(now, seen = []) {
  const inMin = (m) => now + m * 60000;
  return async (url) => {
    seen.push(url);
    let body;
    if (url.includes("wheresthefuckingtrain")) {
      body = { data: [{ id: "L10", name: "Lorimer St",
        N: [{ time: new Date(inMin(3.5)).toISOString() }, { time: new Date(inMin(9.2)).toISOString() }],
        S: [{ time: new Date(inMin(5.5)).toISOString() }, { time: new Date(inMin(12.5)).toISOString() }] }] };
    } else if (url.includes("arrivals-and-departures")) {
      body = { currentTime: now, data: { arrivalsAndDepartures: [
        { routeShortName: "B48", predicted: true, predictedArrivalTime: inMin(4.2), scheduledArrivalTime: inMin(4) },
        { routeShortName: "B48", predicted: false, predictedArrivalTime: 0, scheduledArrivalTime: inMin(20.5) },
        { routeShortName: "B62", predicted: true, predictedArrivalTime: inMin(2.5) },
      ] } };
    } else if (url.includes("stop-monitoring")) {
      body = { Siri: { ServiceDelivery: { StopMonitoringDelivery: [{ MonitoredStopVisit: [] }] } } };
    } else {
      throw new Error("unexpected url " + url);
    }
    return { json: async () => body };
  };
}

module.exports = { call, fakeFeeds };
