import { describe, test, expect } from "bun:test";
import {
  parseSeedConfig,
  buildPersonRecord,
  buildAccountRecord,
  type AdminSeedConfig,
} from "../../../schema/migrate";

describe("admin seed config parsing", () => {
  test("returns config when SELF_HOSTED=true with email and password", () => {
    const result = parseSeedConfig({
      SELF_HOSTED: "true",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "s3cret!pass",
    });
    expect(result).toEqual({
      email: "admin@example.com",
      password: "s3cret!pass",
    });
  });

  test("returns undefined when SELF_HOSTED is not true", () => {
    expect(parseSeedConfig({})).toBeUndefined();
    expect(parseSeedConfig({ SELF_HOSTED: "false" })).toBeUndefined();
    expect(parseSeedConfig({ SELF_HOSTED: "" })).toBeUndefined();
  });

  test("returns undefined when SELF_HOSTED=true but email missing", () => {
    expect(
      parseSeedConfig({ SELF_HOSTED: "true", ADMIN_PASSWORD: "pass" }),
    ).toBeUndefined();
  });

  test("returns undefined when SELF_HOSTED=true but password missing", () => {
    expect(
      parseSeedConfig({ SELF_HOSTED: "true", ADMIN_EMAIL: "a@b.com" }),
    ).toBeUndefined();
  });

  test("trims whitespace from email", () => {
    const result = parseSeedConfig({
      SELF_HOSTED: "true",
      ADMIN_EMAIL: "  admin@example.com  ",
      ADMIN_PASSWORD: "pass",
    });
    expect(result?.email).toBe("admin@example.com");
  });

  test("parses SELF_HOSTED case-insensitively", () => {
    const result = parseSeedConfig({
      SELF_HOSTED: "TRUE",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "pass",
    });
    expect(result).toBeDefined();
  });
});

describe("buildPersonRecord", () => {
  test("creates person record with correct fields", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const record = buildPersonRecord("admin@example.com", now);
    expect(record).toEqual({
      name: "Admin",
      contact_email: "admin@example.com",
      email_verified: true,
      created_at: now,
      updated_at: now,
    });
  });
});

describe("buildAccountRecord", () => {
  test("creates account record with hashed password and credential provider", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const hashedPassword = "$argon2id$v=19$m=65536,t=2,p=1$abc123";
    const record = buildAccountRecord("person-id-123", hashedPassword, now);
    expect(record).toEqual({
      account_id: "person-id-123",
      provider_id: "credential",
      password: hashedPassword,
      created_at: now,
      updated_at: now,
    });
  });

  test("does not contain plaintext password", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const record = buildAccountRecord(
      "id",
      "$argon2id$hashed",
      now,
    );
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("plaintext");
    expect(record.password).toStartWith("$argon2id");
  });
});
