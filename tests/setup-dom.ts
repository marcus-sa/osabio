import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Save native stream implementations before happy-dom overrides them
const NativeReadableStream = globalThis.ReadableStream;
const NativeWritableStream = globalThis.WritableStream;
const NativeTransformStream = globalThis.TransformStream;

GlobalRegistrator.register();

// Restore native stream implementations — happy-dom's polyfills break
// streaming tests that rely on cancel() and TransformStream piping.
globalThis.ReadableStream = NativeReadableStream;
globalThis.WritableStream = NativeWritableStream;
globalThis.TransformStream = NativeTransformStream;
