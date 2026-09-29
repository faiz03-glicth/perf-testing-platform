// Example load test.
//
// By default it boots a tiny local HTTP server in-process so the test runs with
// a single command and no external network. To target a real service instead,
// set TARGET_URL, e.g.:
//   TARGET_URL=https://api.example.com perf-test run examples/backend/hello-load-test.ts

import http from "node:http";

const external = process.env.TARGET_URL;
let baseUrl = external ?? "";

if (!external) {
  const server = http.createServer((req, res) => {
    // Simulate a small, variable server-side latency.
    const delayMs = 5 + Math.random() * 25;
    setTimeout(() => {
      if (req.url === "/error") {
        res.statusCode = 500;
        res.end("simulated error");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, path: req.url, ts: Date.now() }));
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  server.unref(); // let the process exit once the test finishes
}

export const options = {
  stages: [
    { duration: "3s", target: 20 }, // ramp up to 20 VUs
    { duration: "5s", target: 20 }, // hold
    { duration: "2s", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<200", "avg<100"],
    http_req_failed: ["rate<0.1"],
  },
};

export default async function ({ http: client, sleep }) {
  await client.get(`${baseUrl}/api/ping`);
  await sleep(0.1); // think time between requests
}
