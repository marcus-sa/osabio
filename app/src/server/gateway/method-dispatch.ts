/**
 * Gateway method dispatch — pure routing table.
 *
 * Maps MethodName to handler functions. Each handler receives the connection,
 * params, and deps, returning a ResponsePayload. Unregistered methods produce
 * method_not_supported errors.
 *
 * No IO, no side effects, no imports from IO modules.
 */
import type { MethodName, GatewayError } from "./protocol";
import type { GatewayConnection, GatewayDeps } from "./types";

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

export type ResponsePayload =
  | { readonly ok: true; readonly payload?: unknown }
  | { readonly ok: false; readonly error: GatewayError };

export type MethodHandlerContext = {
  readonly deps: GatewayDeps;
};

export type MethodHandler = (
  connection: GatewayConnection,
  params: unknown,
  deps: GatewayDeps,
) => Promise<ResponsePayload>;

// ---------------------------------------------------------------------------
// Dispatch table factory
// ---------------------------------------------------------------------------

export type MethodHandlerMap = Partial<Record<MethodName, MethodHandler>>;

export type DispatchFn = (
  method: MethodName,
  connection: GatewayConnection,
  params: unknown,
  deps: GatewayDeps,
) => Promise<ResponsePayload>;

/**
 * Create a dispatch function from a partial handler map.
 * Methods not in the map return method_not_supported.
 */
export function createMethodDispatch(
  handlers: MethodHandlerMap,
): DispatchFn {
  return async (method, connection, params, deps) => {
    const handler = handlers[method];
    if (!handler) {
      return {
        ok: false,
        error: {
          code: "method_not_supported",
          message: `Method "${method}" is not supported`,
        },
      };
    }
    return handler(connection, params, deps);
  };
}
