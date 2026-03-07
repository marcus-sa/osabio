import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const projectRoot = join(import.meta.dir, "../../../");
const orchestratorDir = join(projectRoot, "app/src/server/orchestrator");

describe("OpenCode module removal (step 03-02)", () => {
  test("spawn-opencode.ts no longer exists", () => {
    expect(existsSync(join(orchestratorDir, "spawn-opencode.ts"))).toBe(false);
  });

  test("config-builder.ts no longer exists", () => {
    expect(existsSync(join(orchestratorDir, "config-builder.ts"))).toBe(false);
  });

  test("@opencode-ai/sdk is not in package.json dependencies", () => {
    const packageJson = JSON.parse(
      readFileSync(join(projectRoot, "package.json"), "utf-8")
    );
    expect(packageJson.dependencies["@opencode-ai/sdk"]).toBeUndefined();
  });
});
