import { describe, expect, it } from "vitest";
import {
  parseDiff,
  type DiffFileSection,
} from "../../../../app/src/client/components/review/diff-parser";

const SINGLE_FILE_DIFF = `diff --git a/src/main.ts b/src/main.ts
index abc1234..def5678 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,5 +1,6 @@
 import { start } from "./server";
+import { logger } from "./logger";

 const port = 3000;
-console.log("starting");
+logger.info("starting");
 start(port);`;

const MULTI_FILE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 export function app() {
+  init();
   return "hello";
 }
diff --git a/src/server.ts b/src/server.ts
deleted file mode 100644
index 3333333..0000000
--- a/src/server.ts
+++ /dev/null
@@ -1,5 +0,0 @@
-import { app } from "./app";
-
-export function start(port: number) {
-  console.log(port);
-}
diff --git a/src/config.ts b/src/config.ts
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/src/config.ts
@@ -0,0 +1,3 @@
+export const config = {
+  port: 3000,
+};`;

describe("parseDiff", () => {
  it("returns empty array for empty string", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("parses single file diff with correct path and line counts", () => {
    const sections = parseDiff(SINGLE_FILE_DIFF);
    expect(sections).toHaveLength(1);
    expect(sections[0].path).toBe("src/main.ts");
    expect(sections[0].additions).toBe(2);
    expect(sections[0].deletions).toBe(1);
    expect(sections[0].status).toBe("modified");
  });

  it("preserves raw diff lines for each file section", () => {
    const sections = parseDiff(SINGLE_FILE_DIFF);
    expect(sections[0].lines.length).toBeGreaterThan(0);
    expect(sections[0].lines.some((l) => l.startsWith("+"))).toBe(true);
    expect(sections[0].lines.some((l) => l.startsWith("-"))).toBe(true);
  });

  it("parses multiple files from a combined diff", () => {
    const sections = parseDiff(MULTI_FILE_DIFF);
    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.path)).toEqual([
      "src/app.ts",
      "src/server.ts",
      "src/config.ts",
    ]);
  });

  it("detects file status: modified, deleted, new", () => {
    const sections = parseDiff(MULTI_FILE_DIFF);
    expect(sections[0].status).toBe("modified");
    expect(sections[1].status).toBe("deleted");
    expect(sections[2].status).toBe("new");
  });

  it("counts additions and deletions per file", () => {
    const sections = parseDiff(MULTI_FILE_DIFF);
    // src/app.ts: +1 addition
    expect(sections[0].additions).toBe(1);
    expect(sections[0].deletions).toBe(0);
    // src/server.ts: -5 deletions
    expect(sections[1].additions).toBe(0);
    expect(sections[1].deletions).toBe(5);
    // src/config.ts: +3 additions
    expect(sections[2].additions).toBe(3);
    expect(sections[2].deletions).toBe(0);
  });
});
