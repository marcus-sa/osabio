## LLM Tool Definitions (Vercel AI SDK)

- Tool `description` is for *what the tool does* and *when to use it*. Keep it concise.
- Parameter-level guidance belongs on `.describe()` in the Zod `inputSchema`, not in the tool description or system prompt.
- For enums, put per-value guidance in `.describe()` on the enum field — the `ai` SDK converts Zod `.describe()` to JSON Schema `description` at every level.
- Do NOT duplicate tool descriptions or parameter guidance in the system prompt. The LLM already receives tool definitions via the `tools` API parameter.
- System prompt should only contain information the LLM cannot get from tool definitions: dynamic context, rendering format instructions, and cross-cutting architectural rules.

## Extraction Schema (Structured Output)

- Azure/OpenRouter structured output requires every property in `properties` to be listed in `required`. Zod `.optional()` fields are excluded from `required` in the generated JSON schema, causing provider rejection.
- Do NOT use `.optional()` in `extractionResultSchema` or its nested entity schemas (`app/src/server/extraction/schema.ts`).
- To represent absence, add a `"none"` sentinel to the enum and strip it to `undefined` via `.transform()` after parsing. The transform is applied during Zod validation but does not affect the JSON schema sent to the provider.
- Existing pattern: `assignee_name` and `resolvedFromMessageId` use union variants (each variant has the field as required) instead of optional fields.
