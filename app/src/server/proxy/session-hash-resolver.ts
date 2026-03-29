/**
 * Session Hash Resolver — Pure Function
 *
 * Derives a deterministic agent session identity from request content
 * using UUIDv5(BRAIN_PROXY_NAMESPACE, system_prompt + NUL + first_user_message).
 *
 * This enables trace grouping via agent_session when no explicit session
 * signal (X-Osabio-Session header or Claude Code metadata) is available.
 *
 * Port: SessionHashInput -> SessionHashResult | undefined
 * Side effects: none (pure function)
 */

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// UUIDv5 Namespace for Brain Proxy
// ---------------------------------------------------------------------------

/** Brain proxy namespace UUID for UUIDv5 generation (randomly generated, fixed). */
const BRAIN_PROXY_NAMESPACE = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

/** NUL separator between system prompt and first user message. */
const NUL_SEPARATOR = "\0";

/** Maximum title length before truncation. */
const MAX_TITLE_LENGTH = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionHashInput = {
  readonly systemPrompt?: string;
  readonly systemPromptBlocks?: ReadonlyArray<{ type: string; text: string }>;
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
};

export type SessionHashResult = {
  readonly sessionId: string;
  readonly title: string;
};

// ---------------------------------------------------------------------------
// UUIDv5 Implementation (RFC 4122)
// ---------------------------------------------------------------------------

function namespaceToBytes(namespaceUuid: string): Buffer {
  const hex = namespaceUuid.replace(/-/g, "");
  return Buffer.from(hex, "hex");
}

function generateUuidV5(namespace: string, name: string): string {
  const namespaceBytes = namespaceToBytes(namespace);
  const nameBytes = Buffer.from(name, "utf-8");

  const hashInput = Buffer.concat([namespaceBytes, nameBytes]);
  const hash = createHash("sha1").update(hashInput).digest();

  // Set version to 5 (bits 4-7 of byte 6)
  hash[6] = (hash[6] & 0x0f) | 0x50;

  // Set variant to RFC 4122 (bits 6-7 of byte 8)
  hash[8] = (hash[8] & 0x3f) | 0x80;

  // Format as UUID string (use first 16 bytes of SHA-1)
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------------------
// Title Truncation
// ---------------------------------------------------------------------------

export function truncateTitle(text: string, maxLength: number = MAX_TITLE_LENGTH): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// ---------------------------------------------------------------------------
// System Prompt Normalization
// ---------------------------------------------------------------------------

function normalizeSystemPrompt(input: SessionHashInput): string | undefined {
  if (input.systemPrompt) return input.systemPrompt;

  if (input.systemPromptBlocks && input.systemPromptBlocks.length > 0) {
    const textBlocks = input.systemPromptBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.text);
    return textBlocks.length > 0 ? textBlocks.join("\n") : undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// First User Message Extraction
// ---------------------------------------------------------------------------

function extractFirstUserMessage(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string | undefined {
  const firstUserMsg = messages.find((msg) => msg.role === "user");
  return firstUserMsg?.content;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a deterministic session identity from request content.
 *
 * Returns undefined when either the system prompt or the first user message
 * is missing -- these are required to compute a stable hash.
 *
 * The session ID is a UUIDv5 derived from:
 *   UUIDv5(BRAIN_PROXY_NAMESPACE, system_prompt + NUL + first_user_message)
 *
 * The title is the first user message, truncated to ~100 characters.
 */
export function resolveSessionHash(
  input: SessionHashInput,
): SessionHashResult | undefined {
  const systemPrompt = normalizeSystemPrompt(input);
  if (!systemPrompt) return undefined;

  const firstUserMessage = extractFirstUserMessage(input.messages);
  if (!firstUserMessage) return undefined;

  const hashContent = systemPrompt + NUL_SEPARATOR + firstUserMessage;
  const sessionId = generateUuidV5(BRAIN_PROXY_NAMESPACE, hashContent);
  const title = truncateTitle(firstUserMessage);

  return { sessionId, title };
}
