import { summarizeDiff } from "./diff";
import { extractContent } from "./extract";
import { stableHash } from "./hash";
import type { CheckResult, MonitorConfig, RunCheckOptions } from "./types";

export async function runCheck(
  monitor: MonitorConfig,
  options: RunCheckOptions = {}
): Promise<CheckResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const startedAt = now();

  try {
    const response = await fetchFn(monitor.url, {
      body: monitor.body,
      headers: monitor.headers,
      method: monitor.method ?? "GET"
    });
    const body = await response.text();
    const responseTimeMs = Math.max(0, now() - startedAt);
    const expectedStatus = monitor.expectedStatus;
    const statusMatches =
      expectedStatus === undefined
        ? response.status >= 200 && response.status < 400
        : response.status === expectedStatus;
    const status = statusMatches ? "up" : "down";

    if (monitor.mode === "uptime") {
      return {
        ok: statusMatches,
        changed: options.previous?.status
          ? options.previous.status !== status
          : false,
        status,
        statusCode: response.status,
        responseTimeMs
      };
    }

    const extractedText = extractContent(
      body,
      response.headers.get("content-type"),
      monitor.extractor ?? { type: "page" }
    );
    const hash = stableHash(extractedText);
    const changed = Boolean(options.previous?.hash && options.previous.hash !== hash);

    return {
      ok: statusMatches,
      changed,
      status,
      statusCode: response.status,
      responseTimeMs,
      hash,
      extractedText,
      diffSummary: changed
        ? summarizeDiff(options.previous?.extractedText, extractedText)
        : undefined
    };
  } catch (error) {
    return {
      ok: false,
      changed: options.previous?.status ? options.previous.status !== "down" : false,
      status: "down",
      responseTimeMs: Math.max(0, now() - startedAt),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
