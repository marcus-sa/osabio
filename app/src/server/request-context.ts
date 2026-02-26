import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  method: string;
  route: string;
  path: string;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContextStorage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
