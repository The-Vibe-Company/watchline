import { bodyToText, decodeHtmlEntities, normalizeText } from "./normalize";
import type { ExtractorSpec, MonitorExtractor } from "./types";

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<HtmlNode | string>;
  parent?: HtmlNode;
}

interface SimpleSelector {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; value?: string }>;
}

type JsonPathToken =
  | { type: "property"; name: string }
  | { type: "index"; index: number }
  | { type: "wildcard" }
  | { type: "recursive"; name: string };

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function extractFirst(input: string, spec: ExtractorSpec): string | undefined {
  return extractAll(input, { ...spec, all: false })[0];
}

export function extractAll(input: string, spec: ExtractorSpec): string[] {
  switch (spec.type) {
    case "css":
      return selectCss(input, spec.selector, spec.attribute).slice(
        0,
        spec.all === false ? 1 : undefined,
      );
    case "jsonpath":
      return selectJsonPath(input, spec.path).slice(
        0,
        spec.all === false ? 1 : undefined,
      );
    case "regex":
      return selectRegex(input, spec);
  }

  return [];
}

export function extractContent(
  input: string,
  contentType: string | null | undefined,
  extractor: MonitorExtractor,
): string {
  if (extractor.type === "page") {
    return bodyToText(input, contentType);
  }

  if (extractor.type === "json-pointer") {
    const value = readJsonPointer(JSON.parse(input) as unknown, extractor.pointer);
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  if (extractor.type === "regex") {
    const source =
      extractor.source === "raw" ? input : bodyToText(input, contentType);
    return extractFirst(source, { ...extractor, all: false }) ?? "";
  }

  return extractAll(input, extractor).join("\n");
}

function selectCss(
  html: string,
  selector: string,
  attribute?: string,
): string[] {
  const root = parseHtml(html);
  const parts = splitSelector(selector).map(parseSimpleSelector);
  const matches: string[] = [];

  for (const node of walkElements(root)) {
    if (!matchesSelector(node, parts)) {
      continue;
    }

    if (attribute && attribute !== "text") {
      const value = node.attrs[attribute.toLowerCase()];
      if (value !== undefined) {
        matches.push(decodeHtmlEntities(value));
      }
    } else {
      const text = normalizeText(textContent(node), { keepLineBreaks: false });
      if (text) {
        matches.push(text);
      }
    }
  }

  return matches;
}

function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: "#document", attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const tokenPattern =
    /<!--[\s\S]*?-->|<\/?([a-z][a-z0-9:-]*)(\s[^<>]*?)?\/?>|([^<]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(html)) !== null) {
    const token = match[0];
    const current = stack[stack.length - 1];

    if (token.startsWith("<!--")) {
      continue;
    }

    if (match[4] !== undefined) {
      current.children.push(decodeHtmlEntities(match[4]));
      continue;
    }

    const tag = match[1]?.toLowerCase();
    if (!tag) {
      continue;
    }

    if (token.startsWith("</")) {
      closeTag(stack, tag);
      continue;
    }

    const node: HtmlNode = {
      tag,
      attrs: parseAttributes(match[2] ?? ""),
      children: [],
      parent: current,
    };
    current.children.push(node);

    if (!token.endsWith("/>") && !VOID_TAGS.has(tag)) {
      stack.push(node);
    }
  }

  return root;
}

function closeTag(stack: HtmlNode[], tag: string): void {
  for (let index = stack.length - 1; index > 0; index -= 1) {
    if (stack[index].tag === tag) {
      stack.length = index;
      return;
    }
  }
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(source)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attrs;
}

function* walkElements(node: HtmlNode): Generator<HtmlNode> {
  for (const child of node.children) {
    if (typeof child === "string") {
      continue;
    }
    yield child;
    yield* walkElements(child);
  }
}

function textContent(node: HtmlNode): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textContent(child)))
    .join(" ");
}

function splitSelector(selector: string): string[] {
  if (/[>,+~:]/.test(selector)) {
    throw new Error(
      "Only lightweight descendant CSS selectors are supported in core",
    );
  }

  const parts: string[] = [];
  let current = "";
  let bracketDepth = 0;
  let quote: string | undefined;

  for (const char of selector.trim()) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth -= 1;
    }

    if (/\s/.test(char) && bracketDepth === 0) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  if (parts.length === 0) {
    throw new Error("CSS selector must not be empty");
  }

  return parts;
}

function parseSimpleSelector(part: string): SimpleSelector {
  const selector: SimpleSelector = { classes: [], attrs: [] };
  let rest = part;
  const tag = rest.match(/^(\*|[a-z][a-z0-9:-]*)/i)?.[1];

  if (tag && tag !== "*") {
    selector.tag = tag.toLowerCase();
    rest = rest.slice(tag.length);
  } else if (tag === "*") {
    rest = rest.slice(1);
  }

  while (rest.length > 0) {
    if (rest.startsWith("#")) {
      const id = readIdentifier(rest.slice(1));
      selector.id = id;
      rest = rest.slice(id.length + 1);
    } else if (rest.startsWith(".")) {
      const className = readIdentifier(rest.slice(1));
      selector.classes.push(className);
      rest = rest.slice(className.length + 1);
    } else if (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      if (end === -1) {
        throw new Error(`Invalid attribute selector: ${part}`);
      }
      selector.attrs.push(parseAttributeSelector(rest.slice(1, end)));
      rest = rest.slice(end + 1);
    } else {
      throw new Error(`Unsupported CSS selector segment: ${rest}`);
    }
  }

  return selector;
}

function readIdentifier(value: string): string {
  const match = value.match(/^[a-z0-9_-]+/i);
  if (!match) {
    throw new Error(`Expected identifier in selector near "${value}"`);
  }
  return match[0];
}

function parseAttributeSelector(source: string): { name: string; value?: string } {
  const match = source
    .trim()
    .match(/^([a-z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?$/i);

  if (!match) {
    throw new Error(`Unsupported attribute selector: [${source}]`);
  }

  return {
    name: match[1].toLowerCase(),
    value: match[2] ?? match[3] ?? match[4],
  };
}

function matchesSelector(node: HtmlNode, parts: SimpleSelector[]): boolean {
  let current: HtmlNode | undefined = node;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (index === parts.length - 1) {
      if (!current || !matchesSimpleSelector(current, parts[index])) {
        return false;
      }
      current = current.parent;
      continue;
    }

    while (current && !matchesSimpleSelector(current, parts[index])) {
      current = current.parent;
    }

    if (!current) {
      return false;
    }

    current = current.parent;
  }

  return true;
}

function matchesSimpleSelector(node: HtmlNode, selector: SimpleSelector): boolean {
  if (selector.tag && node.tag !== selector.tag) {
    return false;
  }

  if (selector.id && node.attrs.id !== selector.id) {
    return false;
  }

  const classList = (node.attrs.class ?? "").split(/\s+/).filter(Boolean);
  if (!selector.classes.every((className) => classList.includes(className))) {
    return false;
  }

  return selector.attrs.every((attr) => {
    const value = node.attrs[attr.name];
    return attr.value === undefined ? value !== undefined : value === attr.value;
  });
}

function selectJsonPath(input: string, path: string): string[] {
  const json = JSON.parse(input) as unknown;
  const tokens = parseJsonPath(path);
  let values = [json];

  for (const token of tokens) {
    values = values.flatMap((value) => applyJsonPathToken(value, token));
  }

  return values.map(stringifyValue);
}

function parseJsonPath(path: string): JsonPathToken[] {
  if (!path.startsWith("$")) {
    throw new Error("JSONPath must start with $");
  }

  const tokens: JsonPathToken[] = [];
  let index = 1;

  while (index < path.length) {
    if (path.startsWith("..", index)) {
      const read = readJsonPathName(path, index + 2);
      tokens.push({ type: "recursive", name: read.name });
      index = read.nextIndex;
    } else if (path[index] === ".") {
      if (path[index + 1] === "*") {
        tokens.push({ type: "wildcard" });
        index += 2;
      } else {
        const read = readJsonPathName(path, index + 1);
        tokens.push({ type: "property", name: read.name });
        index = read.nextIndex;
      }
    } else if (path[index] === "[") {
      const end = path.indexOf("]", index);
      if (end === -1) {
        throw new Error(`Invalid JSONPath bracket expression: ${path}`);
      }
      tokens.push(parseJsonPathBracket(path.slice(index + 1, end)));
      index = end + 1;
    } else {
      throw new Error(`Unsupported JSONPath segment near "${path.slice(index)}"`);
    }
  }

  return tokens;
}

function readJsonPathName(
  path: string,
  startIndex: number,
): { name: string; nextIndex: number } {
  const match = path.slice(startIndex).match(/^[a-zA-Z_$][\w$-]*/);
  if (!match) {
    throw new Error(`Expected JSONPath property near "${path.slice(startIndex)}"`);
  }
  return { name: match[0], nextIndex: startIndex + match[0].length };
}

function parseJsonPathBracket(source: string): JsonPathToken {
  const trimmed = source.trim();
  if (trimmed === "*") {
    return { type: "wildcard" };
  }

  if (/^-?\d+$/.test(trimmed)) {
    return { type: "index", index: Number.parseInt(trimmed, 10) };
  }

  const property = trimmed.match(/^"([^"]+)"$|^'([^']+)'$/);
  if (property) {
    return { type: "property", name: property[1] ?? property[2] };
  }

  throw new Error(`Unsupported JSONPath bracket expression: [${source}]`);
}

function selectJsonPointer(input: string, pointer: string): string[] {
  const value = readJsonPointer(JSON.parse(input) as unknown, pointer);
  return value === undefined ? [] : [stringifyValue(value)];
}

function applyJsonPathToken(value: unknown, token: JsonPathToken): unknown[] {
  switch (token.type) {
    case "property":
      return isRecord(value) && token.name in value ? [value[token.name]] : [];
    case "index":
      return Array.isArray(value) && value[token.index] !== undefined
        ? [value[token.index]]
        : [];
    case "wildcard":
      if (Array.isArray(value)) {
        return value;
      }
      return isRecord(value) ? Object.values(value) : [];
    case "recursive":
      return recursiveJsonValues(value, token.name);
  }
}

function recursiveJsonValues(value: unknown, name: string): unknown[] {
  const output: unknown[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      output.push(...recursiveJsonValues(item, name));
    }
    return output;
  }

  if (!isRecord(value)) {
    return output;
  }

  if (name in value) {
    output.push(value[name]);
  }

  for (const child of Object.values(value)) {
    output.push(...recursiveJsonValues(child, name));
  }

  return output;
}

function selectRegex(
  input: string,
  spec: ExtractorSpec & { type: "regex" },
): string[] {
  const flags = spec.flags ?? "";
  const all = spec.all !== false;
  const regex = new RegExp(
    spec.pattern,
    all && !flags.includes("g") ? `${flags}g` : flags,
  );
  const output: string[] = [];

  if (!all) {
    const match = regex.exec(input);
    return match ? [regexMatchValue(match, spec.group)] : [];
  }

  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    output.push(regexMatchValue(match, spec.group));
    if (match[0] === "") {
      regex.lastIndex += 1;
    }
  }

  return output;
}

function regexMatchValue(
  match: RegExpExecArray,
  group: number | string | undefined,
): string {
  if (typeof group === "number") {
    return match[group] ?? "";
  }
  if (typeof group === "string") {
    return match.groups?.[group] ?? "";
  }
  return match[1] ?? match[0];
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") {
    return value;
  }

  if (!pointer.startsWith("/")) {
    throw new Error("JSON pointer must start with '/'.");
  }

  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((current: unknown, part) => {
      if (Array.isArray(current)) {
        return current[Number(part)];
      }

      if (isRecord(current)) {
        return current[part];
      }

      return undefined;
    }, value);
}
