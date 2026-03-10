import { appendFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "tests/acceptance";
const outputPath = process.env.GITHUB_OUTPUT;

if (!outputPath) {
  throw new Error("GITHUB_OUTPUT is required");
}

const directories = readdirSync(root)
  .filter((name) => statSync(join(root, name)).isDirectory())
  .sort();

appendFileSync(outputPath, `acceptance_dirs=${JSON.stringify(directories)}\n`, "utf8");
