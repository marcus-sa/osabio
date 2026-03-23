import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Save native implementations before happy-dom overrides them
const NativeReadableStream = globalThis.ReadableStream;
const NativeWritableStream = globalThis.WritableStream;
const NativeTransformStream = globalThis.TransformStream;
const NativeFetch = globalThis.fetch;
const NativeRequest = globalThis.Request;
const NativeResponse = globalThis.Response;
const NativeHeaders = globalThis.Headers;

GlobalRegistrator.register();

// Restore native implementations — happy-dom's polyfills break
// streaming tests (cancel() / TransformStream piping) and MSW interception.
globalThis.ReadableStream = NativeReadableStream;
globalThis.WritableStream = NativeWritableStream;
globalThis.TransformStream = NativeTransformStream;
globalThis.fetch = NativeFetch;
globalThis.Request = NativeRequest;
globalThis.Response = NativeResponse;
globalThis.Headers = NativeHeaders;
