// Offline smoke test: runs the real `transit` function with fake MTA feeds.
// Run with: npm test   (from the functions/ folder)
const test = require("node:test");
const assert = require("node:assert");

process.env.MTA_BUS_KEY = "test-key";
const { transit } = require("../index.js");

function fakeFeeds(now) {
  const inMin = (m) => now + m * 60000;
  return async (url) => {
    let body;
    if (url.includes("wheresthefuckingtrain")) {
      body = {
        data: [{
          id: "L10", name: "Lorimer St",
          N: [{ time: new Date(inMin(3.5)).toISOString() }, { time: new Date(inMin(9.2)).toISOString() }],
          S: [{ time: new Date(inMin(5.5)).toISOString() }, { time: new Date(inMin(12.5)).toISOString() }],
        }],
      };
    } else if (url.includes("arrivals-and-departures")) {
      assert.ok(url.includes("key=test-key"), "bus key passed to OneBusAway");
      body = {
        currentTime: now,
        data: { arrivalsAndDepartures: [
          { routeShortName: "B48", predicted: true, predictedArrivalTime: inMin(4.2), scheduledArrivalTime: inMin(4) },
          { routeShortName: "B48", predicted: false, predictedArrivalTime: 0, scheduledArrivalTime: inMin(20.5) },
          { routeShortName: "B62", predicted: true, predictedArrivalTime: inMin(2.5) },
        ] },
      };
    } else if (url.includes("stop-monitoring")) {
      body = { Siri: { ServiceDelivery: { StopMonitoringDelivery: [{ MonitoredStopVisit: [] }] } } };
    } else {
      throw new Error("unexpected url " + url);
    }
    return { json: async () => body };
  };
}

const http = require("node:http");

// Serve the real function on a local port and call it over HTTP
// (uses node:http so the faked global fetch doesn't intercept the call).
function call(query = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      req.query = Object.fromEntries(new URL(req.url, "http://x").searchParams);
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (b) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(b)); };
      transit(req, res);
    });
    server.listen(0, () => {
      const qs = new URLSearchParams(query).toString();
      http.get(`http://127.0.0.1:${server.address().port}/?${qs}`, (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        });
      }).on("error", (e) => { server.close(); reject(e); });
    });
  });
}

test("returns the compact schema the ESP32 expects", async () => {
  global.fetch = fakeFeeds(Date.now());
  const { status, body } = await call({ dir: "SB" });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(Object.keys(body).sort(), ["b", "l"]);
  assert.ok(["MN", "BK"].includes(body.l.dir));
  assert.ok(body.l.t1 >= 3 && body.l.t1 <= 5);
  assert.ok(body.l.t2 > body.l.t1);
  assert.strictEqual(body.b.dir, "SB");
  assert.strictEqual(body.b.t1, 4);
  assert.strictEqual(body.b.live1, true);
  assert.strictEqual(body.b.t2, 20);
  assert.strictEqual(body.b.live2, false);
  assert.ok(JSON.stringify(body).length < 200, "payload stays tiny for the ESP32");
});

test("?dir=NB forces the northbound label", async () => {
  global.fetch = fakeFeeds(Date.now());
  const { body } = await call({ dir: "NB" });
  assert.strictEqual(body.b.dir, "NB");
});

test("upstream outages degrade to -- instead of erroring", async () => {
  global.fetch = async () => { throw new Error("network down"); };
  const { status, body } = await call();
  assert.strictEqual(status, 200);
  assert.strictEqual(body.l.t1, -1);
  assert.strictEqual(body.b.t1, -1);
});
