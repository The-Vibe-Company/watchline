import type { TextDiff, TextDiffOperation } from "./types";

export interface DiffTextOptions {
  ignoreWhitespace?: boolean;
}

export function diffText(
  previous: string,
  current: string,
  options: DiffTextOptions = {},
): TextDiff {
  const oldLines = splitLines(previous, options);
  const newLines = splitLines(current, options);
  const table = buildLcsTable(oldLines, newLines);
  const operations: TextDiffOperation[] = [];

  let oldIndex = oldLines.length;
  let newIndex = newLines.length;

  while (oldIndex > 0 || newIndex > 0) {
    if (
      oldIndex > 0 &&
      newIndex > 0 &&
      oldLines[oldIndex - 1] === newLines[newIndex - 1]
    ) {
      operations.push({
        type: "equal",
        text: previousLine(previous, oldIndex),
        oldLine: oldIndex,
        newLine: newIndex,
      });
      oldIndex -= 1;
      newIndex -= 1;
    } else if (
      newIndex > 0 &&
      (oldIndex === 0 ||
        table[oldIndex][newIndex - 1] >= table[oldIndex - 1][newIndex])
    ) {
      operations.push({
        type: "added",
        text: previousLine(current, newIndex),
        newLine: newIndex,
      });
      newIndex -= 1;
    } else {
      operations.push({
        type: "removed",
        text: previousLine(previous, oldIndex),
        oldLine: oldIndex,
      });
      oldIndex -= 1;
    }
  }

  operations.reverse();

  const additions = operations.filter((operation) => operation.type === "added")
    .length;
  const removals = operations.filter((operation) => operation.type === "removed")
    .length;

  return {
    changed: additions > 0 || removals > 0,
    additions,
    removals,
    operations,
  };
}

export function summarizeDiff(
  previous: string | null | undefined = "",
  current: string | null | undefined = "",
  maxLength = 900,
): string | undefined {
  if (!previous || !current || previous === current) {
    return undefined;
  }

  const diff = diffText(previous, current, { ignoreWhitespace: true });
  if (!diff.changed) {
    return undefined;
  }

  const summary = diff.operations
    .filter((operation) => operation.type !== "equal")
    .slice(0, 16)
    .map((operation) => `${operation.type === "added" ? "+" : "-"} ${operation.text}`)
    .join("\n");

  return summary.length > maxLength ? `${summary.slice(0, maxLength)}...` : summary;
}

function splitLines(input: string, options: DiffTextOptions): string[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  return options.ignoreWhitespace
    ? lines.map((line) => line.replace(/\s+/g, " ").trim())
    : lines;
}

function previousLine(input: string, lineNumber: number): string {
  return input.replace(/\r\n?/g, "\n").split("\n")[lineNumber - 1] ?? "";
}

function buildLcsTable(oldLines: string[], newLines: string[]): number[][] {
  const table = Array.from({ length: oldLines.length + 1 }, () =>
    Array.from({ length: newLines.length + 1 }, () => 0),
  );

  for (let oldIndex = 1; oldIndex <= oldLines.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= newLines.length; newIndex += 1) {
      table[oldIndex][newIndex] =
        oldLines[oldIndex - 1] === newLines[newIndex - 1]
          ? table[oldIndex - 1][newIndex - 1] + 1
          : Math.max(
              table[oldIndex - 1][newIndex],
              table[oldIndex][newIndex - 1],
            );
    }
  }

  return table;
}
