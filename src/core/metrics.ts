// Memory-bounded metric collectors.
//
// Trend metrics use reservoir sampling so percentile accuracy stays high while
// memory stays capped regardless of request volume — important for a load
// generator that must not bottleneck on its own bookkeeping.

import type {
  CounterSummary,
  MetricSummary,
  RateSummary,
  TrendSummary,
} from "./types.js";

const RESERVOIR_CAP = 100_000;

export class Trend {
  private samples: number[] = [];
  private seen = 0;
  count = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;

  add(value: number): void {
    this.count++;
    this.sum += value;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;

    // Reservoir sampling keeps a representative fixed-size sample.
    this.seen++;
    if (this.samples.length < RESERVOIR_CAP) {
      this.samples.push(value);
    } else {
      const j = Math.floor(Math.random() * this.seen);
      if (j < RESERVOIR_CAP) this.samples[j] = value;
    }
  }

  private percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = (p / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    if (low === high) return sorted[low];
    const weight = rank - low;
    return sorted[low] * (1 - weight) + sorted[high] * weight;
  }

  summary(): TrendSummary {
    return {
      kind: "trend",
      count: this.count,
      min: this.count ? this.min : 0,
      max: this.count ? this.max : 0,
      avg: this.count ? this.sum / this.count : 0,
      p50: this.percentile(50),
      p90: this.percentile(90),
      p95: this.percentile(95),
      p99: this.percentile(99),
    };
  }
}

export class Rate {
  passes = 0;
  fails = 0;

  add(isTrue: boolean): void {
    if (isTrue) this.passes++;
    else this.fails++;
  }

  summary(): RateSummary {
    const total = this.passes + this.fails;
    return {
      kind: "rate",
      rate: total ? this.passes / total : 0,
      passes: this.passes,
      fails: this.fails,
      total,
    };
  }
}

export class Counter {
  count = 0;

  add(n = 1): void {
    this.count += n;
  }

  summary(elapsedMs: number): CounterSummary {
    const seconds = elapsedMs / 1000;
    return {
      kind: "counter",
      count: this.count,
      perSecond: seconds > 0 ? this.count / seconds : 0,
    };
  }
}

/** Central registry the HTTP client and executor write into during a run. */
export class MetricsRegistry {
  readonly httpReqs = new Counter();
  readonly httpReqFailed = new Rate();
  readonly httpReqDuration = new Trend();
  readonly iterations = new Counter();
  private customTrends = new Map<string, Trend>();
  private customCounters = new Map<string, Counter>();

  trend(name: string): Trend {
    let t = this.customTrends.get(name);
    if (!t) {
      t = new Trend();
      this.customTrends.set(name, t);
    }
    return t;
  }

  counter(name: string): Counter {
    let c = this.customCounters.get(name);
    if (!c) {
      c = new Counter();
      this.customCounters.set(name, c);
    }
    return c;
  }

  snapshot(elapsedMs: number): Record<string, MetricSummary> {
    const out: Record<string, MetricSummary> = {
      http_reqs: this.httpReqs.summary(elapsedMs),
      http_req_failed: this.httpReqFailed.summary(),
      http_req_duration: this.httpReqDuration.summary(),
      iterations: this.iterations.summary(elapsedMs),
    };
    for (const [name, t] of this.customTrends) out[name] = t.summary();
    for (const [name, c] of this.customCounters) out[name] = c.summary(elapsedMs);
    return out;
  }
}
