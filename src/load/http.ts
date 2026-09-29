// HTTP client wrapper that records metrics for every request.
// Uses the runtime's global fetch (Node >= 18), so no extra dependency.
//
// http_req_failed is a Rate whose value is the FRACTION OF FAILED requests,
// so a threshold like "rate<0.1" reads as "fewer than 10% failed". A request
// counts as failed on a transport error or an HTTP status >= 400.

import { performance } from "node:perf_hooks";
import type { MetricsRegistry } from "../core/metrics.js";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "../core/types.js";

function buildResponse(
  status: number,
  ok: boolean,
  body: string,
  headers: Record<string, string>,
  durationMs: number,
): HttpResponse {
  return {
    status,
    ok,
    body,
    headers,
    durationMs,
    json<T = unknown>(): T {
      return JSON.parse(body) as T;
    },
  };
}

export function createHttpClient(metrics: MetricsRegistry): HttpClient {
  async function request(method: string, url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
    const start = performance.now();
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body: string | undefined;
    if (opts.body !== undefined) {
      if (typeof opts.body === "string") {
        body = opts.body;
      } else {
        body = JSON.stringify(opts.body);
        if (!headers["content-type"] && !headers["Content-Type"]) {
          headers["content-type"] = "application/json";
        }
      }
    }

    try {
      const res = await fetch(url, { method, headers, body });
      const text = await res.text();
      const durationMs = performance.now() - start;
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (outHeaders[k] = v));

      metrics.httpReqs.add();
      metrics.httpReqDuration.add(durationMs);
      metrics.httpReqFailed.add(!res.ok); // add(true) => counted as failed
      return buildResponse(res.status, res.ok, text, outHeaders, durationMs);
    } catch (err) {
      const durationMs = performance.now() - start;
      metrics.httpReqs.add();
      metrics.httpReqDuration.add(durationMs);
      metrics.httpReqFailed.add(true); // transport error => failed
      return buildResponse(0, false, err instanceof Error ? err.message : String(err), {}, durationMs);
    }
  }

  return {
    request,
    get: (url, opts) => request("GET", url, opts),
    post: (url, body, opts) => request("POST", url, { ...opts, body }),
    put: (url, body, opts) => request("PUT", url, { ...opts, body }),
    del: (url, opts) => request("DELETE", url, opts),
  };
}
