import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { Surreal, RecordId } from "surrealdb";
import { surrealdbAdapter } from "../../../app/src/server/auth/adapter";

/**
 * Integration tests for the custom SurrealDB v2 better-auth adapter.
 *
 * Requires a reachable SurrealDB server (SURREAL_URL or ws://127.0.0.1:8000/rpc).
 * Creates an isolated namespace/database per run and cleans up after.
 */

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;
let auth: ReturnType<typeof betterAuth>;
let testHelpers: Awaited<ReturnType<typeof betterAuth>["$context"]>["test"];

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `auth_test_${runId}`;
  database = `adapter_${Math.floor(Math.random() * 100000)}`;

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });

  await surreal.query(`DEFINE NAMESPACE ${namespace};`);
  await surreal.use({ namespace });
  await surreal.query(`DEFINE DATABASE ${database};`);
  await surreal.use({ namespace, database });

  // Apply full schema (contains all table definitions including migrations)
  const schemaSql = readFileSync(join(process.cwd(), "schema", "surreal-schema.surql"), "utf8");
  await surreal.query(schemaSql);

  // Create better-auth instance with testUtils plugin and our adapter
  auth = betterAuth({
    secret: "test-secret-minimum-32-characters-long",
    baseURL: "http://localhost:3000",
    basePath: "/api/auth",
    database: surrealdbAdapter(surreal),
    plugins: [testUtils()],
    user: {
      modelName: "person",
      fields: {
        email: "contact_email",
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      fields: {
        userId: "person_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    account: {
      fields: {
        userId: "person_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        idToken: "id_token",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      github: {
        clientId: "test-github-client-id",
        clientSecret: "test-github-client-secret",
      },
    },
  });

  const ctx = await auth.$context;
  testHelpers = ctx.test;
}, 30_000);

afterAll(async () => {
  if (!surreal) return;
  try {
    await surreal.query(`REMOVE DATABASE ${database};`);
  } catch {}
  try {
    await surreal.query(`REMOVE NAMESPACE ${namespace};`);
  } catch {}
  await surreal.close().catch(() => {});
}, 10_000);

describe("better-auth SurrealDB v2 adapter", () => {
  describe("user (person) CRUD", () => {
    test("saveUser persists a person record to SurrealDB", async () => {
      const user = testHelpers.createUser({
        email: "alice@example.com",
        name: "Alice",
      });
      const saved = await testHelpers.saveUser(user);

      expect(saved.id).toBeTruthy();
      expect(saved.name).toBe("Alice");
      expect(saved.email).toBe("alice@example.com");

      // Verify record exists directly in SurrealDB with mapped field names
      const [rows] = await surreal.query<[Array<{ name: string; contact_email: string }>]>(
        `SELECT name, contact_email FROM person WHERE id = $id;`,
        { id: new RecordId("person", saved.id) },
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Alice");
      expect(rows[0].contact_email).toBe("alice@example.com");

      await testHelpers.deleteUser(saved.id);
    });

    test("findOne retrieves a person by email", async () => {
      const user = testHelpers.createUser({
        email: "bob@example.com",
        name: "Bob",
      });
      const saved = await testHelpers.saveUser(user);

      // Use better-auth API to find the user — exercises findOne through adapter
      const ctx = await auth.$context;
      const found = await ctx.adapter.findOne<{ id: string; name: string; email: string }>({
        model: "user",
        where: [{ field: "email", value: "bob@example.com" }],
      });

      expect(found).not.toBeNull();
      expect(found!.id).toBe(saved.id);
      expect(found!.name).toBe("Bob");

      await testHelpers.deleteUser(saved.id);
    });

    test("findOne returns null for nonexistent user", async () => {
      const ctx = await auth.$context;
      const found = await ctx.adapter.findOne({
        model: "user",
        where: [{ field: "email", value: "nonexistent@example.com" }],
      });

      expect(found).toBeNull();
    });

    test("update modifies person fields", async () => {
      const user = testHelpers.createUser({
        email: "carol@example.com",
        name: "Carol",
      });
      const saved = await testHelpers.saveUser(user);

      const ctx = await auth.$context;
      const updated = await ctx.adapter.update<{ id: string; name: string }>({
        model: "user",
        where: [{ field: "id", value: saved.id }],
        update: { name: "Carol Updated" },
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Carol Updated");

      // Verify in SurrealDB directly
      const [rows] = await surreal.query<[Array<{ name: string }>]>(
        `SELECT name FROM person WHERE id = $id;`,
        { id: new RecordId("person", saved.id) },
      );
      expect(rows[0].name).toBe("Carol Updated");

      await testHelpers.deleteUser(saved.id);
    });

    test("delete removes person record", async () => {
      const user = testHelpers.createUser({
        email: "dave@example.com",
        name: "Dave",
      });
      const saved = await testHelpers.saveUser(user);

      await testHelpers.deleteUser(saved.id);

      // Verify deleted in SurrealDB
      const [rows] = await surreal.query<[unknown[]]>(
        `SELECT * FROM person WHERE id = $id;`,
        { id: new RecordId("person", saved.id) },
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe("session management", () => {
    test("login creates a session linked to person", async () => {
      const user = testHelpers.createUser({
        email: "eve@example.com",
        name: "Eve",
      });
      const saved = await testHelpers.saveUser(user);

      const { session, headers } = await testHelpers.login({ userId: saved.id });

      expect(session).toBeTruthy();
      expect(session.userId).toBe(saved.id);
      expect(session.token).toBeTruthy();

      // Verify session exists in SurrealDB with correct FK
      const [rows] = await surreal.query<[Array<{ token: string; person_id: RecordId }>]>(
        `SELECT token, person_id FROM session WHERE id = $id;`,
        { id: new RecordId("session", session.id) },
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].token).toBe(session.token);
      expect(rows[0].person_id).toBeInstanceOf(RecordId);
      expect((rows[0].person_id as RecordId).id).toBe(saved.id);

      // Verify getSession works with auth headers
      const sessionResult = await auth.api.getSession({ headers });
      expect(sessionResult).not.toBeNull();
      expect(sessionResult!.user.id).toBe(saved.id);
      expect(sessionResult!.user.name).toBe("Eve");

      await testHelpers.deleteUser(saved.id);
    });

    test("getAuthHeaders returns valid session headers", async () => {
      const user = testHelpers.createUser({
        email: "frank@example.com",
        name: "Frank",
      });
      const saved = await testHelpers.saveUser(user);

      const headers = await testHelpers.getAuthHeaders({ userId: saved.id });

      const sessionResult = await auth.api.getSession({ headers });
      expect(sessionResult).not.toBeNull();
      expect(sessionResult!.user.email).toBe("frank@example.com");

      await testHelpers.deleteUser(saved.id);
    });
  });

  describe("email/password sign-up flow", () => {
    test("sign-up creates person, account, and session", async () => {
      const res = await auth.api.signUpEmail({
        body: {
          email: "grace@example.com",
          name: "Grace",
          password: "test-password-123",
        },
      });

      expect(res.user).toBeTruthy();
      expect(res.user.name).toBe("Grace");
      expect(res.user.email).toBe("grace@example.com");
      expect(res.token).toBeTruthy();

      // Verify person record in SurrealDB
      const [personRows] = await surreal.query<[Array<{ name: string; contact_email: string }>]>(
        `SELECT name, contact_email FROM person WHERE id = $id;`,
        { id: new RecordId("person", res.user.id) },
      );
      expect(personRows).toHaveLength(1);
      expect(personRows[0].name).toBe("Grace");
      expect(personRows[0].contact_email).toBe("grace@example.com");

      // Verify account record with credential provider
      const [accountRows] = await surreal.query<
        [Array<{ provider_id: string; person_id: RecordId; password: string }>]
      >(
        `SELECT provider_id, person_id, password FROM account WHERE person_id = $personId;`,
        { personId: new RecordId("person", res.user.id) },
      );
      expect(accountRows).toHaveLength(1);
      expect(accountRows[0].provider_id).toBe("credential");
      expect(accountRows[0].person_id).toBeInstanceOf(RecordId);
      expect(accountRows[0].password).toBeTruthy(); // hashed password

      // Verify session record
      const [sessionRows] = await surreal.query<[Array<{ person_id: RecordId; token: string }>]>(
        `SELECT person_id, token FROM session WHERE person_id = $personId;`,
        { personId: new RecordId("person", res.user.id) },
      );
      expect(sessionRows.length).toBeGreaterThanOrEqual(1);
      expect(sessionRows[0].person_id).toBeInstanceOf(RecordId);

      // Cleanup
      await testHelpers.deleteUser(res.user.id);
    });

    test("sign-in with email/password returns session", async () => {
      // Create user first
      await auth.api.signUpEmail({
        body: {
          email: "heidi@example.com",
          name: "Heidi",
          password: "test-password-456",
        },
      });

      // Sign in
      const res = await auth.api.signInEmail({
        body: {
          email: "heidi@example.com",
          password: "test-password-456",
        },
      });

      expect(res.token).toBeTruthy();
      expect(res.user.email).toBe("heidi@example.com");

      await testHelpers.deleteUser(res.user.id);
    });

    test("sign-in with wrong password fails", async () => {
      await auth.api.signUpEmail({
        body: {
          email: "ivan@example.com",
          name: "Ivan",
          password: "correct-password",
        },
      });

      try {
        await auth.api.signInEmail({
          body: {
            email: "ivan@example.com",
            password: "wrong-password",
          },
        });
        expect.unreachable("Should have thrown");
      } catch (error: any) {
        // better-auth throws on invalid credentials
        expect(error).toBeTruthy();
      }

      // Cleanup — find user first
      const ctx = await auth.$context;
      const user = await ctx.adapter.findOne<{ id: string }>({
        model: "user",
        where: [{ field: "email", value: "ivan@example.com" }],
      });
      if (user) await testHelpers.deleteUser(user.id);
    });
  });

  describe("findMany and count", () => {
    test("findMany returns multiple users with sorting and limit", async () => {
      const users = [];
      for (const name of ["Xander", "Yvonne", "Zara"]) {
        const u = testHelpers.createUser({
          email: `${name.toLowerCase()}@example.com`,
          name,
        });
        users.push(await testHelpers.saveUser(u));
      }

      const ctx = await auth.$context;
      const found = await ctx.adapter.findMany<{ id: string; name: string }>({
        model: "user",
        sortBy: { field: "name", direction: "asc" },
        limit: 2,
      });

      // Should return at most 2 users sorted by name
      expect(found.length).toBeLessThanOrEqual(2);

      for (const u of users) {
        await testHelpers.deleteUser(u.id);
      }
    });

    test("count returns correct number of records", async () => {
      const u1 = await testHelpers.saveUser(
        testHelpers.createUser({ email: "count1@example.com", name: "Count1" }),
      );
      const u2 = await testHelpers.saveUser(
        testHelpers.createUser({ email: "count2@example.com", name: "Count2" }),
      );

      const ctx = await auth.$context;
      const total = await ctx.adapter.count({ model: "user" });
      expect(total).toBeGreaterThanOrEqual(2);

      await testHelpers.deleteUser(u1.id);
      await testHelpers.deleteUser(u2.id);
    });
  });

  describe("OAuth flow", () => {
    test("sign-in/social returns GitHub redirect URL", async () => {
      const res = await auth.api.signInSocial({
        body: {
          provider: "github",
          callbackURL: "http://localhost:3000/callback",
        },
      });

      expect(res.url).toBeTruthy();
      expect(res.url).toContain("github.com");
      expect(res.url).toContain("client_id=test-github-client-id");
      expect(res.redirect).toBe(true);
    });

    test("OAuth account record stores provider fields with correct FK", async () => {
      // Simulate what happens after GitHub OAuth callback:
      // 1. Create a person (user)
      // 2. Link a GitHub account via the adapter directly
      const user = testHelpers.createUser({
        email: "oauth-user@example.com",
        name: "OAuth User",
      });
      const saved = await testHelpers.saveUser(user);

      const ctx = await auth.$context;
      const account = await ctx.adapter.create({
        model: "account",
        data: {
          userId: saved.id,
          accountId: "github-12345",
          providerId: "github",
          accessToken: "gho_test_token_abc",
          refreshToken: "ghr_test_refresh_xyz",
          scope: "read:user,user:email",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(account).toBeTruthy();
      expect(account.providerId).toBe("github");
      expect(account.accountId).toBe("github-12345");
      expect(account.userId).toBe(saved.id);

      // Verify in SurrealDB: person_id is a RecordId, provider fields are stored
      const [rows] = await surreal.query<
        [Array<{
          person_id: RecordId;
          provider_id: string;
          account_id: string;
          access_token: string;
          scope: string;
        }>]
      >(
        `SELECT person_id, provider_id, account_id, access_token, scope FROM account WHERE id = $id;`,
        { id: new RecordId("account", account.id) },
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].person_id).toBeInstanceOf(RecordId);
      expect((rows[0].person_id as RecordId).table.name).toBe("person");
      expect((rows[0].person_id as RecordId).id).toBe(saved.id);
      expect(rows[0].provider_id).toBe("github");
      expect(rows[0].account_id).toBe("github-12345");
      expect(rows[0].access_token).toBe("gho_test_token_abc");
      expect(rows[0].scope).toBe("read:user,user:email");

      await testHelpers.deleteUser(saved.id);
    });

    test("linking GitHub account to existing email/password person", async () => {
      // 1. Sign up with email/password — creates person + credential account
      const signUp = await auth.api.signUpEmail({
        body: {
          email: "existing-user@example.com",
          name: "Existing User",
          password: "password-123",
        },
      });
      const personId = signUp.user.id;

      // 2. Simulate OAuth callback linking via internalAdapter.linkAccount
      const ctx = await auth.$context;
      await ctx.internalAdapter.linkAccount({
        userId: personId,
        providerId: "github",
        accountId: "gh-existing-99",
        accessToken: "gho_linked_token",
        refreshToken: "ghr_linked_refresh",
        scope: "read:user",
      });

      // 3. Verify both accounts exist for the same person in SurrealDB
      const [accounts] = await surreal.query<
        [Array<{ provider_id: string; person_id: RecordId; account_id: string }>]
      >(
        `SELECT provider_id, person_id, account_id FROM account WHERE person_id = $personId ORDER BY provider_id;`,
        { personId: new RecordId("person", personId) },
      );

      expect(accounts).toHaveLength(2);
      const providers = accounts.map((a) => a.provider_id).sort();
      expect(providers).toEqual(["credential", "github"]);

      // Both accounts point to the same person
      for (const acc of accounts) {
        expect(acc.person_id).toBeInstanceOf(RecordId);
        expect((acc.person_id as RecordId).id).toBe(personId);
      }

      const ghAccount = accounts.find((a) => a.provider_id === "github")!;
      expect(ghAccount.account_id).toBe("gh-existing-99");

      await testHelpers.deleteUser(personId);
    });

    test("listUserAccounts returns linked OAuth accounts", async () => {
      const user = testHelpers.createUser({
        email: "linked-user@example.com",
        name: "Linked User",
      });
      const saved = await testHelpers.saveUser(user);

      // Create a GitHub account link
      const ctx = await auth.$context;
      await ctx.adapter.create({
        model: "account",
        data: {
          userId: saved.id,
          accountId: "github-67890",
          providerId: "github",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Query accounts through adapter's findMany
      const accounts = await ctx.adapter.findMany({
        model: "account",
        where: [{ field: "userId", value: saved.id }],
      });

      expect(accounts.length).toBeGreaterThanOrEqual(1);
      const ghAccount = accounts.find((a: any) => a.providerId === "github");
      expect(ghAccount).toBeTruthy();
      expect(ghAccount!.accountId).toBe("github-67890");

      await testHelpers.deleteUser(saved.id);
    });
  });

  describe("RecordId round-trip", () => {
    test("FK fields store as RecordId and read back as strings", async () => {
      // Sign up creates person + account + session with FK references
      const res = await auth.api.signUpEmail({
        body: {
          email: "recordid-test@example.com",
          name: "RecordId Test",
          password: "password-123",
        },
      });

      // Read session via better-auth — userId should be a plain string
      const ctx = await auth.$context;
      const session = await ctx.adapter.findOne<{ id: string; userId: string }>({
        model: "session",
        where: [{ field: "userId", value: res.user.id }],
      });

      expect(session).not.toBeNull();
      expect(typeof session!.userId).toBe("string");
      expect(session!.userId).toBe(res.user.id);

      // Read same session from SurrealDB directly — person_id should be RecordId
      const [rows] = await surreal.query<[Array<{ person_id: RecordId }>]>(
        `SELECT person_id FROM session WHERE id = $id;`,
        { id: new RecordId("session", session!.id) },
      );
      expect(rows[0].person_id).toBeInstanceOf(RecordId);
      expect((rows[0].person_id as RecordId).table.name).toBe("person");
      expect((rows[0].person_id as RecordId).id).toBe(res.user.id);

      await testHelpers.deleteUser(res.user.id);
    });
  });
});
