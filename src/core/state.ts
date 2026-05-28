import { diffText } from "./diff";
import { extractAll } from "./extract";
import { fetchHttp } from "./http";
import { hashText } from "./hash";
import { normalizeHtml, normalizeText } from "./normalize";
import type {
  CheckTargetConfig,
  ContentSnapshot,
  HttpSnapshot,
  StateEvaluation,
  TargetCheckResult,
} from "./types";

export async function checkTarget(
  config: CheckTargetConfig,
  previous?: ContentSnapshot,
): Promise<TargetCheckResult> {
  const http = await fetchHttp(config.url, config.fetch);
  const snapshot = await snapshotFromHttp(http, config);
  const evaluation = evaluateState(previous, snapshot);

  return {
    state: evaluation.state,
    snapshot,
    http,
    diff:
      evaluation.state === "change" && previous
        ? diffText(previous.text, snapshot.text)
        : undefined,
  };
}

export async function snapshotFromHttp(
  http: HttpSnapshot,
  config: Pick<CheckTargetConfig, "extractor" | "hashAlgorithm" | "normalize"> = {},
): Promise<ContentSnapshot> {
  if (!http.ok) {
    return {
      url: http.url,
      status: http.status,
      ok: false,
      text: "",
      hash: await hashText(http.error ?? `HTTP ${http.status}`, config.hashAlgorithm),
      checkedAt: http.fetchedAt,
      error: http.error ?? `HTTP ${http.status}`,
    };
  }

  const extracted = config.extractor
    ? extractAll(http.body, config.extractor).join("\n")
    : http.body;
  const mode =
    config.normalize?.mode ??
    (http.contentType?.toLowerCase().includes("html") ? "html" : "text");
  const text =
    mode === "html"
      ? normalizeHtml(extracted, config.normalize)
      : normalizeText(extracted, config.normalize);

  return {
    url: http.url,
    status: http.status,
    ok: true,
    text,
    hash: await hashText(text, config.hashAlgorithm),
    checkedAt: http.fetchedAt,
  };
}

export function evaluateState(
  previous: ContentSnapshot | undefined,
  current: ContentSnapshot,
): StateEvaluation {
  if (!current.ok) {
    return {
      state: "down",
      previousHash: previous?.hash,
      currentHash: current.hash,
      changed: previous?.hash !== current.hash,
    };
  }

  if (previous?.ok && previous.hash !== current.hash) {
    return {
      state: "change",
      previousHash: previous.hash,
      currentHash: current.hash,
      changed: true,
    };
  }

  return {
    state: "up",
    previousHash: previous?.hash,
    currentHash: current.hash,
    changed: false,
  };
}
