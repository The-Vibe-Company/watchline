#!/usr/bin/env node
import { runCheck } from "./index";
import type { Extractor, MonitorConfig } from "./index";

interface ParsedArgs {
  command?: string;
  url?: string;
  options: Record<string, string | boolean>;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command !== "check" || !parsed.url) {
    printHelp();
    process.exit(parsed.command ? 1 : 0);
  }

  const monitor: MonitorConfig = {
    url: parsed.url,
    mode: parsed.options.regex || parsed.options["json-pointer"] ? "field" : "page",
    expectedStatus: parseNumber(parsed.options["expect-status"]),
    extractor: buildExtractor(parsed.options)
  };

  const result = await runCheck(monitor, {
    previous: {
      hash: asString(parsed.options["previous-hash"])
    }
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

function buildExtractor(options: Record<string, string | boolean>): Extractor | undefined {
  const regex = asString(options.regex);
  const jsonPointer = asString(options["json-pointer"]);

  if (regex) {
    return {
      type: "regex",
      pattern: regex,
      flags: asString(options.flags),
      group: parseNumber(options.group),
      source: options.raw ? "raw" : "text"
    };
  }

  if (jsonPointer) {
    return {
      type: "json-pointer",
      pointer: jsonPointer
    };
  }

  return { type: "page" };
}

function parseArgs(args: string[]): ParsedArgs {
  const [command, url, ...rest] = args;
  const options: ParsedArgs["options"] = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = rest[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }

  return { command, url, options };
}

function parseNumber(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function printHelp(): void {
  process.stdout.write(`watchline

Usage:
  watchline check <url> [options]

Options:
  --expect-status <code>   Require an exact HTTP status code
  --previous-hash <hash>   Mark the check as changed when the new hash differs
  --regex <pattern>        Track the first regex match instead of the whole page
  --group <number>         Regex capture group to track
  --flags <flags>          Regex flags, for example "i"
  --raw                    Run regex against raw response body
  --json-pointer <path>    Track a JSON field, for example /data/status
`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
