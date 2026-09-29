# perf-testing-platform

A unified performance testing platform. The long-term goal is one tool that tests
both the mobile app and the backend it depends on, with baseline tracking and
regression detection built in.

This repository currently contains **Phase 1: the backend load-testing core** —
code-first load tests, an async virtual-user engine, threshold pass/fail, and
regression detection against a saved baseline. Mobile device collectors and the
Maestro E2E runner plug into this same spine in a later phase.

## Requirements

- Node.js 20 or newer (uses the built-in `fetch`).

## Install

```bash
npm install
```

## Run the example

The bundled example boots a tiny local server in-process, so it works offline:

```bash
npm run example
```

That is shorthand for:

```bash
npx tsx src/cli/index.ts run examples/backend/hello-load-test.ts
```

You will see a live progress line, then a report:

```
Load Test - hello-load-test
========================================
Duration:     10.0s
Max VUs:      20
Iterations:   1840

Requests:
  Total         1840
  Throughput    184.0 req/s
  Failed        0 (0.00%)

Latency:
  min           5.1ms
  avg           18.4ms
  p95           38.9ms
  ...

Thresholds:
  http_req_duration  p(95)<200  (observed 38.90)   [PASS]
  http_req_failed    rate<0.1   (observed 0.00)     [PASS]

Result: PASS
```

## Writing a load test

A test is a `.ts` file that exports `options` and a default async function. The
function receives a context with `http`, `sleep`, and `group` — no imports needed.

```ts
export const options = {
  stages: [
    { duration: "30s", target: 100 }, // ramp to 100 virtual users
    { duration: "5m", target: 100 },  // hold
    { duration: "30s", target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.1"],
  },
};

export default async function ({ http, sleep, group }) {
  await group("checkout", async () => {
    await http.post("https://api.example.com/login", { user: "u", pass: "p" });
    await sleep(1);
    await http.get("https://api.example.com/products");
  });
}
```

Instead of `stages`, you can use constant `vus` + `duration`, or override on the
command line with `--vus` and `--duration`.

### Threshold expressions

Keyed by metric name. Aggregations: `p(50|90|95|99)`, `avg`, `med`, `min`,
`max`, `count`, `rate`, `perSecond`. Operators: `< <= > >= == !=`.

- `http_req_duration: ["p(95)<500", "avg<200"]`
- `http_req_failed: ["rate<0.01"]`
- `http_reqs: ["count>10000"]`

## Baselines and regression detection

Record a baseline once, then fail future runs if performance regresses:

```bash
# Save a baseline
npx tsx src/cli/index.ts baseline examples/backend/hello-load-test.ts --save baselines/hello.json

# Fail the run if latency/error-rate/throughput regress by more than 15%
npx tsx src/cli/index.ts run examples/backend/hello-load-test.ts \
  --baseline baselines/hello.json --fail-on-regression 15

# Or compare a previously saved result JSON offline
npx tsx src/cli/index.ts run examples/backend/hello-load-test.ts --out results/run.json
npx tsx src/cli/index.ts compare --current results/run.json --baseline baselines/hello.json
```

The process exits non-zero when a threshold fails or a regression is detected —
suitable for CI gating.

## Commands

```
perf-test run <script.ts> [--vus n] [--duration 30s] [--out file]
                          [--baseline file] [--fail-on-regression pct]
perf-test baseline <script.ts> --save <baseline.json> [--vus n] [--duration 30s]
perf-test compare --current <result.json> --baseline <baseline.json>
                  [--fail-on-regression pct]
```

## Build

```bash
npm run build      # compile to dist/
npm run typecheck  # type-check without emitting
```

After `npm run build`, the `perf-test` bin runs from `dist/`.

## Roadmap

- Phase 2: WebSocket / gRPC / GraphQL / Kafka generators; Prometheus, Grafana,
  Datadog, Dynatrace exporters; distributed execution.
- Mobile: iOS/Android device collectors and Maestro E2E runner sharing this
  baseline + regression spine.
