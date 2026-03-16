/**
 * Unit Tests: Conversation Hash Resolver (Pure Function)
 *
 * The conversation hash resolver derives a deterministic conversation ID
 * from request content using UUIDv5(NAMESPACE, system_prompt + NUL + first_user_message).
 *
 * Properties tested:
 * - Deterministic: same inputs always produce the same conversation ID
 * - Distinct: different system prompts or different first messages produce different IDs
 * - Format: output is a valid UUIDv5 string
 * - Graceful absence: missing system prompt or missing first user message returns undefined
 * - Title truncation: title is truncated to ~100 characters
 */
import { describe, expect, it } from "bun:test";
import {
  resolveConversationHash,
  truncateTitle,
  type ConversationHashInput,
  type ConversationHashResult,
} from "../../app/src/server/proxy/conversation-hash-resolver";

// ---------------------------------------------------------------------------
// Determinism: same inputs produce same output
// ---------------------------------------------------------------------------
describe("resolveConversationHash determinism", () => {
  it("produces the same conversation ID for identical system prompt and first user message", () => {
    const input: ConversationHashInput = {
      systemPrompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hello world" }],
    };

    const result1 = resolveConversationHash(input);
    const result2 = resolveConversationHash(input);

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    expect(result1!.conversationId).toBe(result2!.conversationId);
  });

  it("produces the same ID regardless of subsequent messages (uses only first user message)", () => {
    const input1: ConversationHashInput = {
      systemPrompt: "You are a TypeScript expert.",
      messages: [{ role: "user", content: "How do I use generics?" }],
    };

    const input2: ConversationHashInput = {
      systemPrompt: "You are a TypeScript expert.",
      messages: [
        { role: "user", content: "How do I use generics?" },
        { role: "assistant", content: "Here is how..." },
        { role: "user", content: "Show me an example" },
      ],
    };

    const result1 = resolveConversationHash(input1);
    const result2 = resolveConversationHash(input2);

    expect(result1!.conversationId).toBe(result2!.conversationId);
  });
});

// ---------------------------------------------------------------------------
// Distinctness: different inputs produce different outputs
// ---------------------------------------------------------------------------
describe("resolveConversationHash distinctness", () => {
  it("produces different IDs for different system prompts with same user message", () => {
    const result1 = resolveConversationHash({
      systemPrompt: "You are a Python developer.",
      messages: [{ role: "user", content: "Help me write code" }],
    });

    const result2 = resolveConversationHash({
      systemPrompt: "You are a Rust developer.",
      messages: [{ role: "user", content: "Help me write code" }],
    });

    expect(result1!.conversationId).not.toBe(result2!.conversationId);
  });

  it("produces different IDs for same system prompt with different user messages", () => {
    const result1 = resolveConversationHash({
      systemPrompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Write a function" }],
    });

    const result2 = resolveConversationHash({
      systemPrompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Write a class" }],
    });

    expect(result1!.conversationId).not.toBe(result2!.conversationId);
  });
});

// ---------------------------------------------------------------------------
// UUID format validation
// ---------------------------------------------------------------------------
describe("resolveConversationHash format", () => {
  it("returns a valid UUID v5 string", () => {
    const result = resolveConversationHash({
      systemPrompt: "You are an assistant.",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result).toBeDefined();
    // UUIDv5 format: version nibble = 5, variant bits = 10xx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(result!.conversationId).toMatch(uuidRegex);
  });
});

// ---------------------------------------------------------------------------
// Graceful absence: returns undefined when inputs are missing
// ---------------------------------------------------------------------------
describe("resolveConversationHash graceful absence", () => {
  it("returns undefined when system prompt is missing", () => {
    const result = resolveConversationHash({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when messages array is empty", () => {
    const result = resolveConversationHash({
      systemPrompt: "You are an assistant.",
      messages: [],
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when no user message exists in messages", () => {
    const result = resolveConversationHash({
      systemPrompt: "You are an assistant.",
      messages: [{ role: "assistant", content: "I am ready" }],
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when both system prompt and messages are missing", () => {
    const result = resolveConversationHash({
      messages: [],
    });

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Title derivation
// ---------------------------------------------------------------------------
describe("resolveConversationHash title", () => {
  it("sets title from first user message content", () => {
    const result = resolveConversationHash({
      systemPrompt: "You are a security expert.",
      messages: [{ role: "user", content: "How do I implement OAuth 2.1 with DPoP?" }],
    });

    expect(result!.title).toBe("How do I implement OAuth 2.1 with DPoP?");
  });

  it("truncates long titles to approximately 100 characters", () => {
    const longMessage = "A".repeat(200);
    const result = resolveConversationHash({
      systemPrompt: "You are an assistant.",
      messages: [{ role: "user", content: longMessage }],
    });

    expect(result!.title.length).toBeLessThanOrEqual(103); // 100 + "..."
    expect(result!.title).toEndWith("...");
  });
});

// ---------------------------------------------------------------------------
// truncateTitle utility
// ---------------------------------------------------------------------------
describe("truncateTitle", () => {
  it("returns the string unchanged when under limit", () => {
    expect(truncateTitle("short text", 100)).toBe("short text");
  });

  it("truncates and adds ellipsis when over limit", () => {
    const result = truncateTitle("A".repeat(150), 100);
    expect(result.length).toBe(103);
    expect(result).toEndWith("...");
  });

  it("handles exact limit length", () => {
    const exact = "A".repeat(100);
    expect(truncateTitle(exact, 100)).toBe(exact);
  });
});

// ---------------------------------------------------------------------------
// System prompt as array (Anthropic format)
// ---------------------------------------------------------------------------
describe("resolveConversationHash with array system prompt", () => {
  it("handles system prompt as array of text blocks", () => {
    const result1 = resolveConversationHash({
      systemPrompt: "You are a TypeScript expert.",
      messages: [{ role: "user", content: "Hello" }],
    });

    const result2 = resolveConversationHash({
      systemPromptBlocks: [
        { type: "text", text: "You are a TypeScript expert." },
      ],
      messages: [{ role: "user", content: "Hello" }],
    });

    // Both forms should produce the same hash
    expect(result1!.conversationId).toBe(result2!.conversationId);
  });

  it("concatenates multiple system prompt blocks", () => {
    const result = resolveConversationHash({
      systemPromptBlocks: [
        { type: "text", text: "You are a TypeScript expert." },
        { type: "text", text: "Always use strict mode." },
      ],
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result).toBeDefined();
    expect(result!.conversationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
