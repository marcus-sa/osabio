import { mkdirSync } from "node:fs";
import { defineConfig } from "evalite/config";
import { createSqliteStorage } from "evalite/sqlite-storage";

const outputDir = process.env.EVAL_RESULTS_DIR ?? "eval-results";
mkdirSync(outputDir, { recursive: true });

export default defineConfig({
  setupFiles: ["dotenv/config"],
  storage: () => createSqliteStorage(`${outputDir}/evalite.db`),
  testTimeout: 120000,
  maxConcurrency: 2,
});
