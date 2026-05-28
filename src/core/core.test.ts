import {
  diffText,
  evaluateState,
  extractAll,
  extractFirst,
  hashText,
  normalizeHtml,
} from "./index";
import type { ContentSnapshot } from "./index";

const tests: Array<[string, () => void | Promise<void>]> = [];

function test(name: string, fn: () => void | Promise<void>): void {
  tests.push([name, fn]);
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

test("normalizes lightweight HTML into stable text", () => {
  equal(
    normalizeHtml("<h1>Title&nbsp;</h1><script>noise()</script><p>A   B</p>"),
    "Title\nA B",
  );
});

test("extracts CSS text and attributes", () => {
  const html = `<main><a class="item" href="/one">One</a><a class="item" href="/two">Two</a></main>`;
  deepEqual(
    extractAll(html, { type: "css", selector: "main a.item", all: true }),
    ["One", "Two"],
  );
  equal(
    extractFirst(html, {
      type: "css",
      selector: "a.item",
      attribute: "href",
    }),
    "/one",
  );
});

test("extracts JSONPath values", () => {
  const json = JSON.stringify({ feed: { items: [{ title: "A" }, { title: "B" }] } });
  deepEqual(
    extractAll(json, { type: "jsonpath", path: "$.feed.items[*].title" }),
    ["A", "B"],
  );
});

test("extracts regex groups", () => {
  deepEqual(
    extractAll("v1.2.3 and v2.0.0", {
      type: "regex",
      pattern: "v(\\d+\\.\\d+\\.\\d+)",
      group: 1,
    }),
    ["1.2.3", "2.0.0"],
  );
});

test("hashes text with SHA-256 hex output", async () => {
  const hash = await hashText("watchline");
  equal(hash.length, 64);
  equal(hash, await hashText("watchline"));
});

test("diffs text by line", () => {
  const diff = diffText("a\nb\nc", "a\nb2\nc\nd");
  equal(diff.changed, true);
  equal(diff.additions, 2);
  equal(diff.removals, 1);
});

test("evaluates up, down, and change states", () => {
  const previous: ContentSnapshot = {
    ok: true,
    text: "old",
    hash: "old-hash",
    checkedAt: "2026-05-28T00:00:00.000Z",
  };
  const current: ContentSnapshot = {
    ok: true,
    text: "new",
    hash: "new-hash",
    checkedAt: "2026-05-28T00:01:00.000Z",
  };
  const down: ContentSnapshot = {
    ok: false,
    text: "",
    hash: "error-hash",
    checkedAt: "2026-05-28T00:02:00.000Z",
    error: "timeout",
  };

  equal(evaluateState(undefined, current).state, "up");
  equal(evaluateState(previous, current).state, "change");
  equal(evaluateState(current, down).state, "down");
});

const failures: string[] = [];
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}
