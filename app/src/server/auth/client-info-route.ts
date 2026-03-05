import type { Surreal } from "surrealdb";
import { jsonError, jsonResponse } from "../http/response";

type OAuthClientRow = { clientId: string; name?: string };

/** GET /api/auth/oauth-client/:clientId — public endpoint for consent page client name display */
export function createClientInfoHandler(surreal: Surreal) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const clientId = segments[segments.length - 1];

    if (!clientId) {
      return jsonError("missing client_id", 400);
    }

    const [rows] = await surreal.query<[OAuthClientRow[]]>(
      "SELECT clientId, name FROM oauthClient WHERE clientId = $cid LIMIT 1;",
      { cid: clientId },
    );

    if (!rows || rows.length === 0) {
      return jsonError("client not found", 404);
    }

    return jsonResponse({ client_name: rows[0].name ?? rows[0].clientId }, 200);
  };
}
