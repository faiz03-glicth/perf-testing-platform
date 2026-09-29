// Evaluate threshold expressions against a metric summary.
//
// Supported aggregations: p(NN), avg, med, min, max, count, rate, perSecond.
// Supported operators: <, <=, >, >=, ==, !=.

import type { MetricSummary, ThresholdResult } from "./types.js";

const EXPR = /^\s*(p\(\d{1,3}\)|avg|med|min|max|count|rate|perSecond)\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$/;

function aggregate(summary: MetricSummary, agg: string): number | undefined {
  const pctMatch = agg.match(/^p\((\d{1,3})\)$/);
  if (pctMatch) {
    if (summary.kind !== "trend") return undefined;
    const p = Number(pctMatch[1]);
    if (p === 50) return summary.p50;
    if (p === 90) return summary.p90;
    if (p === 95) return summary.p95;
    if (p === 99) return summary.p99;
    return undefined; // Only common percentiles are precomputed.
  }
  switch (agg) {
    case "med":
      return summary.kind === "trend" ? summary.p50 : undefined;
    case "avg":
      return summary.kind === "trend" ? summary.avg : undefined;
    case "min":
      return summary.kind === "trend" ? summary.min : undefined;
    case "max":
      return summary.kind === "trend" ? summary.max : undefined;
    case "rate":
      return summary.kind === "rate" ? summary.rate : undefined;
    case "count":
      if (summary.kind === "counter") return summary.count;
      if (summary.kind === "trend") return summary.count;
      if (summary.kind === "rate") return summary.total;
      return undefined;
    case "perSecond":
      return summary.kind === "counter" ? summary.perSecond : undefined;
    default:
      return undefined;
  }
}

function compare(observed: number, op: string, target: number): boolean {
  switch (op) {
    case "<":
      return observed < target;
    case "<=":
      return observed <= target;
    case ">":
      return observed > target;
    case ">=":
      return observed >= target;
    case "==":
      return observed === target;
    case "!=":
      return observed !== target;
    default:
      return false;
  }
}

export function evaluateThresholds(
  metrics: Record<string, MetricSummary>,
  thresholds: Record<string, string[]> | undefined,
): ThresholdResult[] {
  if (!thresholds) return [];
  const results: ThresholdResult[] = [];
  for (const [metric, expressions] of Object.entries(thresholds)) {
    const summary = metrics[metric];
    for (const expression of expressions) {
      const match = expression.match(EXPR);
      if (!summary || !match) {
        results.push({ metric, expression, observed: NaN, passed: false });
        continue;
      }
      const [, agg, op, targetStr] = match;
      const observed = aggregate(summary, agg);
      if (observed === undefined) {
        results.push({ metric, expression, observed: NaN, passed: false });
        continue;
      }
      results.push({
        metric,
        expression,
        observed,
        passed: compare(observed, op, Number(targetStr)),
      });
    }
  }
  return results;
}
