// Machine-readable JSON output for CI pipelines and dashboards.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunResult } from "../core/types.js";

export async function writeJsonReport(path: string, result: RunResult): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2), "utf8");
}
