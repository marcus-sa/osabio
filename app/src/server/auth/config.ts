import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { RecordId, type Surreal } from "surrealdb";
import { surrealdbAdapter } from "./adapter";
import { BRAIN_SCOPES } from "./scopes";

export type AuthConfig = {
  betterAuthSecret: string;
  betterAuthUrl: string;
  githubClientId: string;
  githubClientSecret: string;
};

export function createAuth(surreal: Surreal, config: AuthConfig) {
  const allScopes = [
    "openid",
    "profile",
    "email",
    "offline_access",
    ...Object.keys(BRAIN_SCOPES),
  ];

  return betterAuth({
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl,
    basePath: "/api/auth",
    database: surrealdbAdapter(surreal),
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
      storeSessionInDatabase: true,
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
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
      },
    },
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: allScopes,
        validAudiences: [config.betterAuthUrl],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        accessTokenExpiresIn: 3600,
        refreshTokenExpiresIn: 2592000,
        customAccessTokenClaims: async ({ user }) => {
          if (!user) return {};
          const [memberRows] = await surreal.query<
            [Array<{ workspace_id: RecordId<"workspace", string>; workspace_name: string }>]
          >(
            `SELECT out.id AS workspace_id, out.name AS workspace_name
             FROM member_of
             WHERE in IN (SELECT VALUE in FROM identity_person WHERE out = $person)
             LIMIT 1;`,
            { person: new RecordId("person", user.id) },
          );

          if (memberRows.length === 0) {
            return {};
          }

          return {
            "urn:brain:workspace": memberRows[0].workspace_id.id as string,
            "urn:brain:workspace_name": memberRows[0].workspace_name,
            "urn:brain:agent_type": "code_agent",
          };
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
