import { describe, test, expect } from "bun:test";
import { buildEmailAndPasswordConfig } from "../../../app/src/server/auth/config";

/**
 * Tests for self-hosted Argon2id password hashing configuration.
 *
 * Behaviors under test:
 * 1. When selfHosted=true, emailAndPassword config includes custom hash/verify
 * 2. When selfHosted=false, emailAndPassword config has no custom password handlers
 * 3. Custom hash produces an argon2id hash string
 * 4. Custom verify correctly validates a password against its hash
 */

describe("buildEmailAndPasswordConfig", () => {
  describe("when selfHosted is false", () => {
    test("returns enabled with no custom password config", () => {
      const config = buildEmailAndPasswordConfig(false);
      expect(config.enabled).toBe(true);
      expect(config.password).toBeUndefined();
    });
  });

  describe("when selfHosted is true", () => {
    test("returns enabled with custom hash and verify functions", () => {
      const config = buildEmailAndPasswordConfig(true);
      expect(config.enabled).toBe(true);
      expect(config.password).toBeDefined();
      expect(typeof config.password!.hash).toBe("function");
      expect(typeof config.password!.verify).toBe("function");
    });

    test("hash produces an argon2id hash string", async () => {
      const config = buildEmailAndPasswordConfig(true);
      const hash = await config.password!.hash("test-password");
      expect(hash).toStartWith("$argon2id$");
    });

    test("verify returns true for matching password", async () => {
      const config = buildEmailAndPasswordConfig(true);
      const hash = await config.password!.hash("correct-password");
      const result = await config.password!.verify({
        hash,
        password: "correct-password",
      });
      expect(result).toBe(true);
    });

    test("verify returns false for wrong password", async () => {
      const config = buildEmailAndPasswordConfig(true);
      const hash = await config.password!.hash("correct-password");
      const result = await config.password!.verify({
        hash,
        password: "wrong-password",
      });
      expect(result).toBe(false);
    });
  });
});
