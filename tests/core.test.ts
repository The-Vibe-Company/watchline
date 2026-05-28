import { describe, expect, it } from "vitest";
import { extractContent, normalizeHtml, runCheck, stableHash } from "../src";

describe("core normalization", () => {
  it("removes scripts, styles, tags, and unstable spacing", () => {
    expect(
      normalizeHtml("<style>.x{}</style><h1>Hello&nbsp;world</h1><script>1</script>")
    ).toContain("Hello world");
  });
});

describe("extractContent", () => {
  it("extracts JSON pointer values", () => {
    expect(
      extractContent('{"data":{"status":"ready"}}', "application/json", {
        type: "json-pointer",
        pointer: "/data/status"
      })
    ).toBe("ready");
  });

  it("extracts regex capture groups", () => {
    expect(
      extractContent("<p>Price: 42 EUR</p>", "text/html", {
        type: "regex",
        pattern: "Price: (\\d+)",
        group: 1
      })
    ).toBe("42");
  });
});

describe("runCheck", () => {
  it("returns a stable hash and detects content changes", async () => {
    const first = await runCheck(
      { mode: "page", url: "https://example.com" },
      {
        fetchFn: async () =>
          new Response("<h1>Version one</h1>", {
            headers: { "content-type": "text/html" },
            status: 200
          }),
        now: () => 0
      }
    );

    const second = await runCheck(
      { mode: "page", url: "https://example.com" },
      {
        fetchFn: async () =>
          new Response("<h1>Version two</h1>", {
            headers: { "content-type": "text/html" },
            status: 200
          }),
        now: () => 0,
        previous: {
          extractedText: first.extractedText,
          hash: first.hash,
          status: first.status
        }
      }
    );

    expect(first.hash).toBe(stableHash("Version one"));
    expect(second.changed).toBe(true);
    expect(second.diffSummary).toContain("Version two");
  });
});
