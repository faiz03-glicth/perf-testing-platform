// Async virtual-user executor.
//
// VUs are cooperative async tasks on Node's single-threaded event loop rather
// than OS threads, so a modest generator sustains high concurrency without the
// per-thread memory cost that would otherwise bottleneck the load itself.

import { performance } from "node:perf_hooks";
import { MetricsRegistry } from "../core/metrics.js";
import { parseDuration } from "../core/duration.js";
import { evaluateThresholds } from "../core/thresholds.js";
import { createHttpClient } from "./http.js";
import { makeGroup, sleep, type LoadedScript } from "./script.js";
import type { LoadOptions, RunResult, Stage, VuContext } from "../core/types.js";

interface Point {
  atMs: number;
  target: number;
}

/** Builds the ramp schedule (VU target over time) and total run duration. */
function buildSchedule(options: LoadOptions): { points: Point[]; totalMs: number } {
  if (options.stages && options.stages.length > 0) {
    const points: Point[] = [{ atMs: 0, target: 0 }];
    let at = 0;
    for (const stage of options.stages as Stage[]) {
      at += parseDuration(stage.duration);
      points.push({ atMs: at, target: stage.target });
    }
    return { points, totalMs: at };
  }
  const vus = options.vus ?? 1;
  const totalMs = parseDuration(options.duration ?? "30s");
  return {
    points: [
      { atMs: 0, target: vus },
      { atMs: totalMs, target: vus },
    ],
    totalMs,
  };
}

/** Linear interpolation of the VU target at a given elapsed time. */
function targetAt(points: Point[], elapsedMs: number): number {
  if (elapsedMs <= points[0].atMs) return points[0].target;
  const last = points[points.length - 1];
  if (elapsedMs >= last.atMs) return last.target;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (elapsedMs <= b.atMs) {
      const span = b.atMs - a.atMs;
      const frac = span === 0 ? 1 : (elapsedMs - a.atMs) / span;
      return Math.round(a.target + (b.target - a.target) * frac);
    }
  }
  return last.target;
}

interface Worker {
  id: number;
  stop: boolean;
  done: Promise<void>;
}

const CONTROL_TICK_MS = 200;

export interface RunOptions {
  scenarioName: string;
  onProgress?: (info: { elapsedMs: number; activeVus: number; iterations: number; reqs: number }) => void;
}

export async function runLoadTest(script: LoadedScript, runOpts: RunOptions): Promise<RunResult> {
  const metrics = new MetricsRegistry();
  const http = createHttpClient(metrics);
  const group = makeGroup(metrics);

  const { points, totalMs } = buildSchedule(script.options);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const elapsed = () => performance.now() - start;

  let running = true;
  let iterationCounter = 0;
  let vusMax = 0;
  let nextId = 1;
  const workers = new Map<number, Worker>();

  function spawn(): void {
    const id = nextId++;
    const worker: Worker = { id, stop: false, done: Promise.resolve() };
    worker.done = (async () => {
      while (running && !worker.stop) {
        const ctx: VuContext = {
          vu: worker.id,
          iteration: iterationCounter++,
          http,
          sleep,
          group,
        };
        try {
          await script.run(ctx);
        } catch {
          // A thrown iteration is a logic error in the script body; the HTTP
          // client already records transport/status failures itself.
        }
        metrics.iterations.add();
      }
    })();
    workers.set(id, worker);
  }

  function scaleTo(target: number): void {
    let active = 0;
    for (const w of workers.values()) if (!w.stop) active++;
    if (active > vusMax) vusMax = active;

    if (target > active) {
      for (let i = 0; i < target - active; i++) spawn();
    } else if (target < active) {
      let toStop = active - target;
      for (const w of workers.values()) {
        if (toStop <= 0) break;
        if (!w.stop) {
          w.stop = true;
          toStop--;
        }
      }
    }
  }

  await new Promise<void>((resolveRun) => {
    const timer = setInterval(() => {
      const e = elapsed();
      if (e >= totalMs) {
        running = false;
        for (const w of workers.values()) w.stop = true;
        clearInterval(timer);
        resolveRun();
        return;
      }
      scaleTo(targetAt(points, e));
      let active = 0;
      for (const w of workers.values()) if (!w.stop) active++;
      runOpts.onProgress?.({
        elapsedMs: e,
        activeVus: active,
        iterations: metrics.iterations.count,
        reqs: metrics.httpReqs.count,
      });
    }, CONTROL_TICK_MS);

    // Kick off immediately so we don't idle for the first tick.
    scaleTo(targetAt(points, 0));
  });

  await Promise.all([...workers.values()].map((w) => w.done));

  const durationMs = elapsed();
  const snapshot = metrics.snapshot(durationMs);
  const thresholds = evaluateThresholds(snapshot, script.options.thresholds);

  return {
    scenario: runOpts.scenarioName,
    startedAt,
    durationMs,
    iterations: metrics.iterations.count,
    vusMax,
    metrics: snapshot,
    thresholds,
    passed: thresholds.every((t) => t.passed),
  };
}
