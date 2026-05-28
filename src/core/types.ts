export type MonitorState = "up" | "down" | "change";
export type MonitorMode = "uptime" | "page" | "field";

export type HeaderMap = Record<string, string>;

export interface FetchHttpOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  userAgent?: string;
  followRedirects?: boolean;
}

export interface HttpSnapshot {
  url: string;
  status: number;
  ok: boolean;
  headers: HeaderMap;
  body: string;
  fetchedAt: string;
  durationMs: number;
  contentType?: string;
  error?: string;
}

export interface NormalizeOptions {
  mode?: "html" | "text";
  lowercase?: boolean;
  trim?: boolean;
  collapseWhitespace?: boolean;
  keepLineBreaks?: boolean;
  stripScripts?: boolean;
}

export interface CssExtractor {
  type: "css";
  selector: string;
  attribute?: string;
  all?: boolean;
}

export interface JsonPathExtractor {
  type: "jsonpath";
  path: string;
  all?: boolean;
}

export interface RegexExtractor {
  type: "regex";
  pattern: string;
  flags?: string;
  group?: number | string;
  source?: "raw" | "text";
  all?: boolean;
}

export type ExtractorSpec =
  | CssExtractor
  | JsonPathExtractor
  | JsonPointerExtractor
  | RegexExtractor;

export type PageExtractor = {
  type: "page";
};

export type JsonPointerExtractor = {
  type: "json-pointer";
  pointer: string;
  all?: boolean;
};

export type MonitorExtractor = PageExtractor | JsonPointerExtractor | ExtractorSpec;
export type Extractor = MonitorExtractor;

export interface TextDiffOperation {
  type: "equal" | "added" | "removed";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface TextDiff {
  changed: boolean;
  additions: number;
  removals: number;
  operations: TextDiffOperation[];
}

export interface ContentSnapshot {
  url?: string;
  status?: number;
  ok: boolean;
  text: string;
  hash: string;
  checkedAt: string;
  error?: string;
}

export interface StateEvaluation {
  state: MonitorState;
  previousHash?: string;
  currentHash: string;
  changed: boolean;
}

export interface CheckTargetConfig {
  url: string;
  fetch?: FetchHttpOptions;
  extractor?: ExtractorSpec;
  normalize?: NormalizeOptions;
  hashAlgorithm?: "SHA-256" | "SHA-384" | "SHA-512";
}

export interface MonitorConfig {
  id?: string;
  name?: string;
  url: string;
  mode: MonitorMode;
  intervalMinutes?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  expectedStatus?: number;
  extractor?: MonitorExtractor;
}

export interface PreviousCheck {
  status?: "up" | "down" | null;
  hash?: string | null;
  extractedText?: string | null;
}

export interface RunCheckOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  previous?: PreviousCheck;
}

export interface TargetCheckResult {
  state: MonitorState;
  snapshot: ContentSnapshot;
  http: HttpSnapshot;
  diff?: TextDiff;
}

export interface CheckResult {
  ok: boolean;
  changed: boolean;
  status: "up" | "down";
  statusCode?: number;
  responseTimeMs: number;
  hash?: string;
  extractedText?: string;
  diffSummary?: string;
  error?: string;
}
