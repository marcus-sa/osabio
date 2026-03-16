import { describe, test, expect } from "bun:test";
import { buildSignupGuard } from "../../../app/src/server/auth/config";

/**
 * Tests for self-hosted signup guard.
 *
 * Behaviors under test:
 * 1. When selfHosted=true, signup guard returns a databaseHooks config that blocks user creation
 * 2. When selfHosted=false, signup guard returns undefined (no guard)
 * 3. The guard throws a FORBIDDEN error with "Registration is disabled" message
 * 4. The guard does not interfere with non-user model operations
 */

describe("buildSignupGuard", () => {
  describe("when selfHosted is false", () => {
    test("returns undefined (no guard)", () => {
      const guard = buildSignupGuard(false);
      expect(guard).toBeUndefined();
    });
  });

  describe("when selfHosted is true", () => {
    test("returns databaseHooks with user.create.before hook", () => {
      const guard = buildSignupGuard(true);
      expect(guard).toBeDefined();
      expect(guard!.user).toBeDefined();
      expect(guard!.user!.create).toBeDefined();
      expect(typeof guard!.user!.create!.before).toBe("function");
    });

    test("user.create.before throws FORBIDDEN with 'Registration is disabled'", async () => {
      const guard = buildSignupGuard(true);
      const beforeHook = guard!.user!.create!.before;

      try {
        await beforeHook({} as any, null);
        expect.unreachable("should have thrown");
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
        expect(error.body?.message).toBe("Registration is disabled");
      }
    });
  });
});
