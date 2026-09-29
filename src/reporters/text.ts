// Plain, high-contrast terminal report. No colors required to read it.

import { formatDuration } from "../core/duration.js";
import type { RegressionReport } from "../core/baseline.js";
import type { RunResult } from "../core/types.js";

function ms(n: number): string {
  return `${n.toFixed(1)}ms`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

// Pad to `width`, but always leave at least two spaces when the text overruns,
// so long metric names never collide with their values.
function col(text: string, width: number): string {
  return text.length >= width ? `${text}  ` : text.padEnd(width);
}

function line(label: string, value: string, verdict?: string): string {
  const base = `  ${col(label, 20)}${value}`;
  if (!verdict) return base;
  return base.length >= 46 ? `${base}  ${verdict}` : `${base.padEnd(46)}${verdict}`;
}

export function renderRunReport(result: RunResult): string {
  const out: string[] = [];
  out.push(`Load Test - ${result.scenario}`);
  out.push("=".repeat(40));
  out.push(`Duration:     ${formatDuration(result.durationMs)}`);
  out.push(`Max VUs:      ${result.vusMax}`);
  out.push(`Iterations:   ${result.iterations}`);
  out.push("");

  const reqs = result.metrics.http_reqs;
  const failed = result.metrics.http_req_failed;
  const dur = result.metrics.http_req_duration;

  if (reqs?.kind === "counter") {
    out.push("Requests:");
    out.push(line("Total", String(reqs.count)));
    out.push(line("Throughput", `${reqs.perSecond.toFixed(1)} req/s`));
    if (failed?.kind === "rate") {
      out.push(line("Failed", `${failed.passes} (${pct(failed.rate)})`));
    }
    out.push("");
  }

  if (dur?.kind === "trend" && dur.count > 0) {
    out.push("Latency:");
    out.push(line("min", ms(dur.min)));
    out.push(line("avg", ms(dur.avg)));
    out.push(line("p50", ms(dur.p50)));
    out.push(line("p90", ms(dur.p90)));
    out.push(line("p95", ms(dur.p95)));
    out.push(line("p99", ms(dur.p99)));
    out.push(line("max", ms(dur.max)));
    out.push("");
  }

  if (result.thresholds.length > 0) {
    out.push("Thresholds:");
    for (const t of result.thresholds) {
      const verdict = t.passed ? "[PASS]" : "[FAIL]";
      const observed = Number.isNaN(t.observed) ? "n/a" : t.observed.toFixed(2);
      out.push(line(t.metric, `${t.expression}  (observed ${observed})`, verdict));
    }
    out.push("");
  }

  out.push(`Result: ${result.passed ? "PASS" : "FAIL"}`);
  return out.join("\n");
}

export function renderRegressionReport(report: RegressionReport): string {
  const out: string[] = [];
  out.push("");
  out.push(`Regression check (tolerance ${report.tolerancePct}%)`);
  out.push("-".repeat(40));
  for (const e of report.entries) {
    const arrow = e.changePct >= 0 ? "+" : "";
    const verdict = e.regressed ? "[REGRESSED]" : "[ok]";
    const label = `${e.metric}.${e.aggregation}`;
    out.push(
      line(
        label,
        `${e.baseline.toFixed(2)} -> ${e.current.toFixed(2)} (${arrow}${e.changePct.toFixed(1)}%)`,
        verdict,
      ),
    );
  }
  out.push("");
  out.push(`Regression: ${report.regressed ? "DETECTED" : "none"}`);
  return out.join("\n");
}
