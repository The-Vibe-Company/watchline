export {
  checkTarget,
  decodeHtmlEntities,
  diffText,
  evaluateState,
  extractAll,
  extractFirst,
  fetchHttp,
  hashText,
  runCheck,
  snapshotFromHttp,
  summarizeDiff,
} from "./core/index";
export { extractContent } from "./core/extract";
export { stableHash } from "./core/hash";
export { bodyToText, normalizeHtml, normalizeText } from "./core/normalize";
export type {
  CheckResult,
  CheckTargetConfig,
  ContentSnapshot,
  CssExtractor,
  Extractor,
  ExtractorSpec,
  FetchHttpOptions,
  MonitorConfig,
  MonitorMode,
  MonitorState,
  PreviousCheck,
  RegexExtractor,
  RunCheckOptions,
  TargetCheckResult,
  TextDiff
} from "./core/types";
