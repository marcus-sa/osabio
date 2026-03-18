import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "schema",
  "migrations",
  "0053_reactive_coordination_fields.surql"
);

describe("Migration 0053: reactive coordination fields", () => {
  it("migration file exists", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it("defines last_request_at on agent_session as option<datetime>", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("DEFINE FIELD");
    expect(sql).toContain("last_request_at");
    expect(sql).toContain("agent_session");
    expect(sql).toMatch(/option<datetime>/);
  });

  it("defines description_embedding on agent as option<array<float>>", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("description_embedding");
    expect(sql).toContain("agent");
    expect(sql).toMatch(/option<array<float>>/);
  });

  it("defines HNSW COSINE index on agent description_embedding", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("DEFINE INDEX");
    expect(sql).toContain("HNSW");
    expect(sql).toContain("DIMENSION 1536");
    expect(sql).toContain("COSINE");
  });

  it("wraps in a transaction", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("BEGIN TRANSACTION");
    expect(sql).toContain("COMMIT TRANSACTION");
  });
});
