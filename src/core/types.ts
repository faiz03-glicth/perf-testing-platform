// Shared type definitions for the platform.

/** A single stage in a load profile: ramp active virtual users to `target` over `duration`. */
export interface Stage {
  /** Human duration, e.g. "30s", "5m", "1h". */
  duration: string;
  /** Virtual users to reach by the end of this stage. */
  target: number;
}

/** Options a load-test script exports. */
export interface LoadOptions {
  /** Ramping profile. Takes precedence over `vus`/`duration` when present. */
  stages?: Stage[];
  /** Constant virtual users (used when `stages` is absent). */
  vus?: number;
  /** Constant duration (used when `stages` is absent), e.g. "30s". */
  duration?: string;
  /**
   * Pass/fail rules keyed by metric name. Each value is a list of expressions
   * such as "p(95)<500", "avg<300", "rate<0.1", "count>1000".
   */
  thresholds?: Record<string, string[]>;
}

/** Context handed to each virtual-user iteration. */
export interface VuContext {
  /** 1-based virtual user id. */
  vu: number;
  /** 0-based iteration count for this run (monotonic across all VUs). */
  iteration: number;
  http: HttpClient;
  sleep: (seconds: number) => Promise<void>;
  group: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
  headers: Record<string, string>;
  durationMs: number;
  json<T = unknown>(): T;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  /** Attempt HTTP/2 where the runtime supports it (best effort). */
  http2?: boolean;
}

export interface HttpClient {
  get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse>;
  post(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse>;
  put(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse>;
  del(url: string, opts?: HttpRequestOptions): Promise<HttpResponse>;
  request(method: string, url: string, opts?: HttpRequestOptions): Promise<HttpResponse>;
}

/** Aggregated statistics for a trend metric (durations, etc.). */
export interface TrendSummary {
  kind: "trend";
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

/** Aggregated statistics for a rate metric (share of true samples). */
export interface RateSummary {
  kind: "rate";
  /** Fraction in [0,1]. */
  rate: number;
  passes: number;
  fails: number;
  total: number;
}

/** Aggregated statistics for a counter metric. */
export interface CounterSummary {
  kind: "counter";
  count: number;
  /** Per-second rate over the run. */
  perSecond: number;
}

export type MetricSummary = TrendSummary | RateSummary | CounterSummary;

export interface ThresholdResult {
  metric: string;
  expression: string;
  observed: number;
  passed: boolean;
}

export interface RunResult {
  scenario: string;
  startedAt: string;
  durationMs: number;
  iterations: number;
  vusMax: number;
  metrics: Record<string, MetricSummary>;
  thresholds: ThresholdResult[];
  /** True when every threshold passed (or none were defined). */
  passed: boolean;
}

/** A saved baseline used for regression comparison. */
export interface Baseline {
  scenario: string;
  savedAt: string;
  metrics: Record<string, MetricSummary>;
  iterations: number;
}
