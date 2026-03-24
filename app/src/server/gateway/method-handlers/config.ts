/**
 * Config handler -- returns read-only gateway configuration.
 *
 * Static response: protocol version, supported features, tick interval.
 * No IO, no deps access needed beyond the static payload.
 */
import type { MethodHandler } from "../method-dispatch";

// ---------------------------------------------------------------------------
// Config payload -- static gateway capabilities
// ---------------------------------------------------------------------------

type ConfigGetPayload = {
  readonly gateway: {
    readonly version: string;
    readonly protocol: number;
    readonly features: ReadonlyArray<string>;
    readonly tickIntervalMs: number;
  };
};

const GATEWAY_CONFIG: ConfigGetPayload = {
  gateway: {
    version: "1.0.0",
    protocol: 3,
    features: ["sessions", "tools", "presence", "exec-approval"],
    tickIntervalMs: 15_000,
  },
};

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createConfigGetHandler(): MethodHandler {
  return async (_connection, _params, _deps) => {
    return {
      ok: true,
      payload: GATEWAY_CONFIG,
    };
  };
}
