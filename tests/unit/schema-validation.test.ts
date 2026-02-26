import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseExtractionOutput } from "../../app/src/server/extraction/schema";

const fixturesDir = join(process.cwd(), "tests", "fixtures", "extraction-outputs");

describe("extraction schema validation", () => {
  it("accepts valid extraction payloads", () => {
    const payload = JSON.parse(readFileSync(join(fixturesDir, "valid.json"), "utf8")) as unknown;
    const parsed = parseExtractionOutput(payload);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.entities.length).toBeGreaterThan(0);
      expect(parsed.data.relationships.length).toBeGreaterThan(0);
    }
  });

  it("rejects malformed JSON payloads gracefully", () => {
    const malformed = "{ \"entities\": [}";

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(malformed);
    } catch {
      parsedBody = undefined;
    }

    const parsed = parseExtractionOutput(parsedBody);
    expect(parsed.ok).toBe(false);
  });

  it("fails when required fields are missing", () => {
    const payload = JSON.parse(readFileSync(join(fixturesDir, "missing-required-fields.json"), "utf8")) as unknown;
    const parsed = parseExtractionOutput(payload);

    expect(parsed.ok).toBe(false);
  });
});
