// Helpers exposed to load-test scripts via the VU context, plus script loading.

import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { MetricsRegistry } from "../core/metrics.js";
import type { LoadOptions, VuContext } from "../core/types.js";

export function sleep(seconds: number): Promise<void> {
  return new Promise((r) => setTimeout(r, seconds * 1000));
}

/** Runs `fn`, recording its wall time under a `group_<name>_duration` trend. */
export function makeGroup(metrics: MetricsRegistry) {
  return async function group<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      metrics.trend(`group_${name}_duration`).add(performance.now() - start);
    }
  };
}

export interface LoadedScript {
  options: LoadOptions;
  run: (ctx: VuContext) => unknown | Promise<unknown>;
}

/** Dynamically imports a user script file exporting `options` and a default fn. */
export async function loadScript(scriptPath: string): Promise<LoadedScript> {
  const abs = resolve(process.cwd(), scriptPath);
  const mod = await import(pathToFileURL(abs).href);
  const run = mod.default;
  if (typeof run !== "function") {
    throw new Error(`Script "${scriptPath}" must export a default async function.`);
  }
  const options: LoadOptions = mod.options ?? {};
  return { options, run };
}
