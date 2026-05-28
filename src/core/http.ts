import type { FetchHttpOptions, HeaderMap, HttpSnapshot } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchHttp(
  url: string | URL,
  options: FetchHttpOptions = {},
): Promise<HttpSnapshot> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const headers = new Headers(options.headers);
    if (options.userAgent && !headers.has("user-agent")) {
      headers.set("user-agent", options.userAgent);
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body ?? undefined,
      redirect: options.followRedirects === false ? "manual" : "follow",
      signal: controller.signal,
    });
    const body = await response.text();

    return {
      url: response.url || String(url),
      status: response.status,
      ok: response.ok,
      headers: headersToObject(response.headers),
      body,
      contentType: response.headers.get("content-type") ?? undefined,
      fetchedAt,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      url: String(url),
      status: 0,
      ok: false,
      headers: {},
      body: "",
      fetchedAt,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function headersToObject(headers: Headers): HeaderMap {
  const output: HeaderMap = {};
  headers.forEach((value, key) => {
    output[key.toLowerCase()] = value;
  });
  return output;
}
