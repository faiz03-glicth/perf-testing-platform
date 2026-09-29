// Parse human-readable durations like "30s", "5m", "1h30m", "500ms" into milliseconds.

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

export function parseDuration(input: string): number {
  const text = input.trim();
  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    matched = true;
    total += parseFloat(match[1]) * UNIT_MS[match[2]];
  }
  if (!matched) {
    throw new Error(`Invalid duration: "${input}" (expected e.g. "30s", "5m", "1h30m", "500ms")`);
  }
  return total;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem ? `${m}m${rem}s` : `${m}m`;
}
