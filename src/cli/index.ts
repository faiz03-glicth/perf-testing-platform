#!/usr/bin/env node
// Command-line entry point for the load-testing MVP.
//
// Commands:
//   run <script>      Run a load test. Optional baseline comparison.
//   baseline <script> Run a load test and save the result as a baseline.
//   compare           Compare a saved result JSON against a baseline.

import { parseArgs } from "node:util";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { formatDuration } from "../core/duration.js";
import { loadScript, type LoadedScript } from "../load/script.js";
import { runLoadTest } from "../load/executor.js";
import { renderRegressionReport, renderRunReport } from "../reporters/text.js";
import { writeJsonReport } from "../reporters/json.js";
import {
  detectRegressions,
  loadBaseline,
  saveBaseline,
  toBaseline,
} from "../core/baseline.js";
import type { RunResult } from "../core/types.js";

const HELP = `perf-test - unified performance testing platform (load-testing MVP)

Usage:
  perf-test run <script.ts> [options]
  perf-test baseline <script.ts> --save <baseline.json> [options]
  perf-test compare --current <result.json> --baseline <baseline.json> [--fail-on-regression <pct>]

Options:
  --vus <n>                  Override constant virtual users
  --duration <dur>           Override duration (e.g. 30s, 5m)
  --out <file>               Write JSON result to file
  --baseline <file>          Compare run against this baseline
  --save <file>              (baseline cmd) Path to write the baseline
  --fail-on-regression <pct> Regression tolerance percent (default 10)
  -h, --help                 Show this help

Examples:
  perf-test run examples/backend/hello-load-test.ts
  perf-test run examples/backend/hello-load-test.ts --vus 50 --duration 20s --out results/run.json
  perf-test baseline examples/backend/hello-load-test.ts --save baselines/hello.json
  perf-test run examples/backend/hello-load-test.ts --baseline baselines/hello.json --fail-on-regression 15
`;

function progressLine(elapsedMs: number, activeVus: number, iterations: number, reqs: number): void {
  const text = `  [${formatDuration(elapsedMs).padStart(7)}] vus=${String(activeVus).padStart(5)}  iters=${String(iterations).padStart(7)}  reqs=${String(reqs).padStart(8)}`;
  process.stderr.write(`\r${text}`);
}

function applyOverrides(script: LoadedScript, values: Record<string, unknown>): void {
  if (values.vus !== undefined) {
    script.options.stages = undefined;
    script.options.vus = Number(values.vus);
  }
  if (values.duration !== undefined) {
    script.options.stages = undefined;
    script.options.duration = String(values.duration);
  }
}

async function runCommand(scriptPath: string, values: Record<string, unknown>): Promise<number> {
  const script = await loadScript(scriptPath);
  applyOverrides(script, values);

  const scenarioName = basename(scriptPath).replace(/\.[tj]s$/, "");
  process.stderr.write(`Running "${scenarioName}"...\n`);

  const result = await runLoadTest(script, {
    scenarioName,
    onProgress: (i) => progressLine(i.elapsedMs, i.activeVus, i.iterations, i.reqs),
  });
  process.stderr.write("\n\n");

  process.stdout.write(renderRunReport(result) + "\n");

  if (values.out) {
    await writeJsonReport(String(values.out), result);
    process.stderr.write(`\nJSON written to ${values.out}\n`);
  }

  let regressed = false;
  if (values.baseline) {
    const baseline = await loadBaseline(String(values.baseline));
    const tolerance = values["fail-on-regression"] !== undefined ? Number(values["fail-on-regression"]) : 10;
    const report = detectRegressions(result, baseline, tolerance);
    process.stdout.write(renderRegressionReport(report) + "\n");
    regressed = report.regressed;
  }

  return result.passed && !regressed ? 0 : 1;
}

async function baselineCommand(scriptPath: string, values: Record<string, unknown>): Promise<number> {
  if (!values.save) {
    process.stderr.write("Error: baseline requires --save <baseline.json>\n");
    return 2;
  }
  const script = await loadScript(scriptPath);
  applyOverrides(script, values);

  const scenarioName = basename(scriptPath).replace(/\.[tj]s$/, "");
  process.stderr.write(`Recording baseline for "${scenarioName}"...\n`);

  const result = await runLoadTest(script, {
    scenarioName,
    onProgress: (i) => progressLine(i.elapsedMs, i.activeVus, i.iterations, i.reqs),
  });
  process.stderr.write("\n\n");

  process.stdout.write(renderRunReport(result) + "\n");
  await saveBaseline(String(values.save), toBaseline(result));
  process.stderr.write(`\nBaseline written to ${values.save}\n`);
  return result.passed ? 0 : 1;
}

async function compareCommand(values: Record<string, unknown>): Promise<number> {
  if (!values.current || !values.baseline) {
    process.stderr.write("Error: compare requires --current <result.json> and --baseline <baseline.json>\n");
    return 2;
  }
  const current = JSON.parse(await readFile(String(values.current), "utf8")) as RunResult;
  const baseline = await loadBaseline(String(values.baseline));
  const tolerance = values["fail-on-regression"] !== undefined ? Number(values["fail-on-regression"]) : 10;
  const report = detectRegressions(current, baseline, tolerance);
  process.stdout.write(renderRegressionReport(report) + "\n");
  return report.regressed ? 1 : 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      vus: { type: "string" },
      duration: { type: "string" },
      out: { type: "string" },
      baseline: { type: "string" },
      save: { type: "string" },
      current: { type: "string" },
      "fail-on-regression": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(HELP);
    return command ? 0 : values.help ? 0 : 1;
  }

  switch (command) {
    case "run": {
      const script = positionals[1];
      if (!script) {
        process.stderr.write("Error: run requires a script path\n");
        return 2;
      }
      return runCommand(script, values);
    }
    case "baseline": {
      const script = positionals[1];
      if (!script) {
        process.stderr.write("Error: baseline requires a script path\n");
        return 2;
      }
      return baselineCommand(script, values);
    }
    case "compare":
      return compareCommand(values);
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`\n${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
