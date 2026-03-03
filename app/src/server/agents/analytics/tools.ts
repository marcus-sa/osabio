import { tool } from "ai";
import { z } from "zod";
import type { Surreal } from "surrealdb";

export function createAnalyticsTools(analyticsSurreal: Surreal) {
  return {
    execute_analytics_query: tool({
      description:
        "Execute a read-only SurrealQL SELECT query against the knowledge graph. Use parameterized queries ($param syntax) for any dynamic values. Always include a LIMIT clause.",
      inputSchema: z.object({
        intent: z.string().min(1).describe("What you are trying to learn from this query"),
        query: z.string().min(1).describe("The SurrealQL SELECT query to execute"),
        parameters: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Query parameters as key-value pairs, referenced as $key in the query"),
      }),
      execute: async (input) => {
        console.log("[analytics] query:", input.query);
        if (input.parameters) console.log("[analytics] params:", JSON.stringify(input.parameters));
        try {
          const result = await analyticsSurreal.query(input.query, input.parameters ?? {});
          const rows = Array.isArray(result) ? result.flat() : [result];
          console.log("[analytics] result: %d rows", rows.length, JSON.stringify(rows).slice(0, 500));
          return {
            success: true as const,
            result: rows,
            row_count: rows.length,
          };
        } catch (error) {
          console.log("[analytics] error:", error instanceof Error ? error.message : String(error));
          return {
            success: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
  };
}
