// Save and load baselines, and detect regressions against them.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Baseline, MetricSummary, RunResult } from "./types.js";

export function toBaseline(result: RunResult): Baseline {
  return {
    scenario: result.scenario,
    savedAt: new Date().toISOString(),
    metrics: result.metrics,
    iterations: result.iterations,
  };
}

export async function saveBaseline(path: string, baseline: Baseline): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(baseline, null, 2), "utf8");
}

export async function loadBaseline(path: string): Promise<Baseline> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as Baseline;
}

export interface RegressionEntry {
  metric: string;
  aggregation: string;
  baseline: number;
  current: number;
  /** Signed percentage change from baseline to current. */
  changePct: number;
  /** True when the change is a worsening beyond tolerance. */
  regressed: boolean;
  /** "lower-better" or "higher-better". */
  direction: "lower-better" | "higher-better";
}

export interface RegressionReport {
  tolerancePct: number;
  entries: RegressionEntry[];
  /** True when any tracked metric regressed beyond tolerance. */
  regressed: boolean;
}

// Which aggregate to compare per metric, and whether higher is worse.
const COMPARISONS: Array<{
  metric: string;
  aggregation: string;
  pick: (m: MetricSummary) => number | undefined;
  direction: "lower-better" | "higher-better";
}> = [
  {
    metric: "http_req_duration",
    aggregation: "p95",
    pick: (m) => (m.kind === "trend" ? m.p95 : undefined),
    direction: "lower-better",
  },
  {
    metric: "http_req_duration",
    aggregation: "avg",
    pick: (m) => (m.kind === "trend" ? m.avg : undefined),
    direction: "lower-better",
  },
  {
    metric: "http_req_failed",
    aggregation: "rate",
    pick: (m) => (m.kind === "rate" ? m.rate : undefined),
    direction: "lower-better",
  },
  {
    metric: "http_reqs",
    aggregation: "perSecond",
    pick: (m) => (m.kind === "counter" ? m.perSecond : undefined),
    direction: "higher-better",
  },
];

export function detectRegressions(
  current: RunResult,
  baseline: Baseline,
  tolerancePct: number,
): RegressionReport {
  const entries: RegressionEntry[] = [];
  for (const cmp of COMPARISONS) {
    const baseVal = baseline.metrics[cmp.metric] && cmp.pick(baseline.metrics[cmp.metric]);
    const curVal = current.metrics[cmp.metric] && cmp.pick(current.metrics[cmp.metric]);
    if (baseVal === undefined || curVal === undefined) continue;

    // Percentage change relative to baseline (guard divide-by-zero).
    const denom = baseVal === 0 ? (curVal === 0 ? 1 : Math.abs(curVal)) : Math.abs(baseVal);
    const changePct = ((curVal - baseVal) / denom) * 100;

    const worsePct = cmp.direction === "lower-better" ? changePct : -changePct;
    const regressed = worsePct > tolerancePct;

    entries.push({
      metric: cmp.metric,
      aggregation: cmp.aggregation,
      baseline: baseVal,
      current: curVal,
      changePct,
      regressed,
      direction: cmp.direction,
    });
  }
  return {
    tolerancePct,
    entries,
    regressed: entries.some((e) => e.regressed),
  };
}
