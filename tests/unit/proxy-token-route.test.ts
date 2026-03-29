import { beforeEach, describe, expect, it, mock } from "bun:test";
import { RecordId } from "surrealdb";
import type { ServerDependencies } from "../../app/src/server/runtime/types";

type Claims = { sub?: string };

let validatorsByIssuer: Record<string, (token: string) => Promise<Claims>> = {};
const createJwtValidatorMock = mock((issuerUrl: string) => {
  const validator = validatorsByIssuer[issuerUrl];
  if (validator) {
    return validator;
  }
  return async () => {
    throw new Error("invalid token");
  };
});

mock.module("../../app/src/server/mcp/token-validation", () => ({
  createJwtValidator: createJwtValidatorMock,
}));

async function loadCreateProxyTokenHandler() {
  const mod = await import("../../app/src/server/proxy/proxy-token-route");
  return mod.createProxyTokenHandler;
}

function makeDeps(input: {
  getSession: (args: { headers: Headers }) => Promise<{ user?: { id?: string } } | undefined>;
  query: (sql: string, vars?: Record<string, unknown>) => Promise<unknown>;
  betterAuthUrl?: string;
}): ServerDependencies {
  return {
    auth: { api: { getSession: input.getSession } },
    surreal: { query: input.query },
    config: { betterAuthUrl: input.betterAuthUrl ?? "http://localhost:3000" },
  } as unknown as ServerDependencies;
}

describe("createProxyTokenHandler", () => {
  beforeEach(() => {
    validatorsByIssuer = {};
    createJwtValidatorMock.mockClear();
  });

  it("accepts OAuth bearer token when session is missing and token validates against /api/auth audience", async () => {
    validatorsByIssuer = {
      "http://localhost:3000": async () => {
        throw new Error("audience mismatch");
      },
      "http://localhost:3000/api/auth": async (token: string) => {
        if (token !== "oauth-bearer") {
          throw new Error("invalid token");
        }
        return { sub: "person-123" };
      },
    };

    let resolvePersonId: string | undefined;
    const queryMock = mock(async (sql: string, vars?: Record<string, unknown>) => {
      if (sql.includes("LET $identities")) {
        const person = vars?.person as RecordId<"person", string>;
        resolvePersonId = person.id;
        return [undefined, [new RecordId("identity", "identity-123")]];
      }

      if (sql.includes("BEGIN TRANSACTION")) {
        return [];
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const createProxyTokenHandler = await loadCreateProxyTokenHandler();
    const handler = createProxyTokenHandler(makeDeps({
      getSession: async () => undefined,
      query: queryMock,
    }));

    const response = await handler(new Request("http://localhost:3000/api/auth/proxy-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer oauth-bearer",
      },
      body: JSON.stringify({ workspace_id: "ws-123" }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      proxy_token: string;
      workspace_id: string;
      expires_at: string;
    };
    expect(payload.workspace_id).toBe("ws-123");
    expect(payload.proxy_token.startsWith("osp_")).toBe(true);
    expect(resolvePersonId).toBe("person-123");
    expect(createJwtValidatorMock).toHaveBeenCalledWith("http://localhost:3000");
    expect(createJwtValidatorMock).toHaveBeenCalledWith("http://localhost:3000/api/auth");
  });

  it("returns 401 when session is missing and bearer token validation fails", async () => {
    validatorsByIssuer = {
      "http://localhost:3000": async () => {
        throw new Error("invalid token");
      },
      "http://localhost:3000/api/auth": async () => {
        throw new Error("invalid token");
      },
    };

    const queryMock = mock(async () => {
      throw new Error("query should not execute when auth fails");
    });

    const createProxyTokenHandler = await loadCreateProxyTokenHandler();
    const handler = createProxyTokenHandler(makeDeps({
      getSession: async () => undefined,
      query: queryMock,
    }));

    const response = await handler(new Request("http://localhost:3000/api/auth/proxy-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid",
      },
      body: JSON.stringify({ workspace_id: "ws-123" }),
    }));

    expect(response.status).toBe(401);
    const payload = await response.json() as { error: string };
    expect(payload.error).toBe("invalid_session");
  });
});
