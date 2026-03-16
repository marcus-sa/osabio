import { describe, test, expect } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Acceptance test for step 03-01: all log call sites migrated to OTEL logger.
 *
 * Verifies that no production server file imports logInfo/logWarn/logError/logDebug
 * from the old observability module.
 */

async function collectTsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectTsFiles(fullPath)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("OTEL log migration", () => {
  test("zero imports of logInfo/logWarn/logError/logDebug remain in app/src/server/", async () => {
    const serverDir = join(import.meta.dir, "../../app/src/server");
    const files = await collectTsFiles(serverDir);

    const oldLogPattern = /\b(logInfo|logWarn|logError|logDebug)\b/;
    const violations: string[] = [];

    for (const filePath of files) {
      // Skip the telemetry logger itself (it documents the old API in comments)
      if (filePath.includes("telemetry/logger.ts")) continue;

      const content = await Bun.file(filePath).text();
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
        if (oldLogPattern.test(line)) {
          const relative = filePath.replace(serverDir, "");
          violations.push(`${relative}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("observability.ts only exports elapsedMs and userFacingError", async () => {
    const obsPath = join(import.meta.dir, "../../app/src/server/http/observability.ts");
    const content = await Bun.file(obsPath).text();

    // Should not export any log functions
    expect(content).not.toContain("export function logInfo");
    expect(content).not.toContain("export function logWarn");
    expect(content).not.toContain("export function logError");
    expect(content).not.toContain("export function logDebug");

    // Should still export these
    expect(content).toContain("export function elapsedMs");
    expect(content).toContain("export function userFacingError");
  });
});
