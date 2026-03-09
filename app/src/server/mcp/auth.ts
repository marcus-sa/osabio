import { RecordId, type Surreal } from "surrealdb";
import { jsonError } from "../http/response";
import type { AgentType } from "../chat/tools/types";
import { createJwtValidator, type BrainTokenClaims } from "./token-validation";
import type { McpAuthResult } from "./types";

type WorkspaceRow = {
  id: RecordId<"workspace", string>;
  name: string;
};

const VALID_AGENT_TYPES = new Set<AgentType>([
  "code_agent", "architect", "management", "design_partner", "observer",
]);

const validatorsByIssuer = new Map<string, (token: string) => Promise<BrainTokenClaims>>();

/**
 * Authenticate an MCP request via OAuth 2.1 JWT Bearer token.
 * Validates the JWT signature via JWKS, extracts claims, and verifies workspace access.
 * Returns auth context on success, or an error Response.
 */
export async function authenticateMcpRequest(
  request: Request,
  workspaceId: string,
  surreal: Surreal,
  issuerUrl: string,
): Promise<McpAuthResult | Response> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonError("missing or invalid Authorization header", 401);
  }

  const token = authHeader.slice(7);
  if (!token) {
    return jsonError("empty Bearer token", 401);
  }

  // Get or create a JWT validator for this issuer URL (safe for concurrent test suites)
  let validateToken = validatorsByIssuer.get(issuerUrl);
  if (!validateToken) {
    validateToken = createJwtValidator(issuerUrl);
    validatorsByIssuer.set(issuerUrl, validateToken);
  }

  let claims: BrainTokenClaims;
  try {
    claims = await validateToken(token);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[MCP Auth] JWT validation failed: ${detail}`);
    return jsonError("invalid or expired token", 401);
  }

  // Extract person from sub claim (better-auth user model is person)
  const personId = claims.sub;
  if (!personId) {
    return jsonError("token missing sub claim", 401);
  }

  // Extract workspace from custom claim or verify against requested workspace
  const claimedWorkspace = claims["urn:brain:workspace"];
  if (claimedWorkspace && claimedWorkspace !== workspaceId) {
    return jsonError("token workspace does not match requested workspace", 403);
  }

  // Verify workspace exists
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const workspace = await surreal.select<WorkspaceRow>(workspaceRecord);
  if (!workspace) {
    return jsonError("workspace not found", 404);
  }

  // Resolve identity from person via spoke edge
  const personRecord = new RecordId("person", personId);
  const [identityRows] = await surreal.query<[Array<RecordId<"identity", string>>]>(
    "SELECT VALUE in FROM identity_person WHERE out = $person LIMIT 1;",
    { person: personRecord },
  );
  const identityRecord = identityRows[0];
  if (!identityRecord) {
    return jsonError("identity not found for token owner", 403);
  }

  // If no workspace claim in token, verify membership via DB
  if (!claimedWorkspace) {
    const [memberRows] = await surreal.query<[Array<{ role: string }>]>(
      `SELECT role FROM member_of WHERE in = $identity AND out = $ws LIMIT 1;`,
      { identity: identityRecord, ws: workspaceRecord },
    );
    if (!memberRows || memberRows.length === 0) {
      return jsonError("token owner is not a member of this workspace", 403);
    }
  }

  // Extract scopes from token
  const scopeString = claims.scope ?? "";
  const scopes = new Set(scopeString.split(" ").filter(Boolean));

  // Agent type from header or from token claim
  const claimedAgentType = claims["urn:brain:agent_type"];
  const rawAgentType = request.headers.get("x-agent-type") ?? claimedAgentType ?? "code_agent";
  if (!VALID_AGENT_TYPES.has(rawAgentType as AgentType)) {
    return jsonError(`invalid agent type: ${rawAgentType}`, 400);
  }

  return {
    workspaceRecord,
    workspaceName: workspace.name,
    agentType: rawAgentType as AgentType,
    identityRecord,
    scopes,
    humanPresent: false as const,
  };
}
