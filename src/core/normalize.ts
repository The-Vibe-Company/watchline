import type { NormalizeOptions } from "./types";

const DEFAULT_NORMALIZE_OPTIONS: Required<
  Pick<
    NormalizeOptions,
    "collapseWhitespace" | "keepLineBreaks" | "stripScripts" | "trim"
  >
> = {
  collapseWhitespace: true,
  keepLineBreaks: true,
  stripScripts: true,
  trim: true,
};

export function normalizeHtml(
  html: string,
  options: NormalizeOptions = {},
): string {
  const merged = { ...DEFAULT_NORMALIZE_OPTIONS, ...options };
  let value = html;

  if (merged.stripScripts) {
    value = value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
    value = value.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
    value = value.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  }

  value = value.replace(/<!--[\s\S]*?-->/g, " ");
  value = value.replace(
    /<\/?(address|article|aside|blockquote|br|div|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi,
    "\n",
  );
  value = value.replace(/<[^>]+>/g, " ");
  value = decodeHtmlEntities(value);

  return normalizeText(value, {
    ...options,
    collapseWhitespace: merged.collapseWhitespace,
    keepLineBreaks: merged.keepLineBreaks,
    trim: merged.trim,
  });
}

export function normalizeText(
  text: string,
  options: NormalizeOptions = {},
): string {
  const merged = { ...DEFAULT_NORMALIZE_OPTIONS, ...options };
  let value = text.replace(/\r\n?/g, "\n");

  if (options.lowercase) {
    value = value.toLowerCase();
  }

  if (merged.collapseWhitespace) {
    value = merged.keepLineBreaks
      ? value
          .split("\n")
          .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
          .filter(Boolean)
          .join("\n")
      : value.replace(/\s+/g, " ");
  }

  return merged.trim ? value.trim() : value;
}

export function bodyToText(body: string, contentType?: string | null): string {
  return contentType?.toLowerCase().includes("html")
    ? normalizeHtml(body, { keepLineBreaks: false })
    : normalizeText(body, { keepLineBreaks: false });
}

export function decodeHtmlEntities(input: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      return safeCodePoint(Number.parseInt(lower.slice(2), 16), match);
    }
    if (lower.startsWith("#")) {
      return safeCodePoint(Number.parseInt(lower.slice(1), 10), match);
    }
    return namedEntities[lower] ?? match;
  });
}

function safeCodePoint(value: number, fallback: string): string {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}
