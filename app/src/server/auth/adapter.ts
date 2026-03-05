import { createAdapterFactory, type CleanedWhere } from "better-auth/adapters";
import { RecordId, type Surreal } from "surrealdb";

/**
 * Custom SurrealDB v2 adapter for better-auth.
 *
 * Uses the project's existing Surreal connection (SDK v2) instead of creating
 * its own. All field names arrive pre-mapped by the factory (e.g., "contact_email"
 * not "email", "person_id" not "userId").
 *
 * `findOne` returns `null` (not `undefined`) per better-auth contract —
 * boundary exception to project no-null rule.
 */
export function surrealdbAdapter(surreal: Surreal) {
  return createAdapterFactory({
    config: {
      adapterId: "surrealdb-v2",
      adapterName: "SurrealDB v2",
      usePlural: false,
      supportsJSON: true,
      supportsDates: true,
      supportsBooleans: true,
      supportsNumericIds: false,
    },
    adapter: ({ schema, getModelName, getFieldName }) => {
      // Build FK map: { dbTableName → { dbColumnName → referencedDbTableName } }
      const fkMap = new Map<string, Map<string, string>>();
      for (const [defaultModel, modelDef] of Object.entries(schema)) {
        const dbTable = getModelName(defaultModel);
        const tableFks = new Map<string, string>();
        for (const [defaultField, fieldAttr] of Object.entries(modelDef.fields)) {
          if (fieldAttr.references?.field === "id") {
            const dbColumn = getFieldName({ model: defaultModel, field: defaultField });
            const refDbTable = getModelName(fieldAttr.references.model);
            tableFks.set(dbColumn, refDbTable);
          }
        }
        if (tableFks.size > 0) {
          fkMap.set(dbTable, tableFks);
        }
      }

      function getFkTable(model: string, field: string): string | undefined {
        return fkMap.get(model)?.get(field);
      }

      /** Convert string FK values to RecordId for writes/where clauses. */
      function toRecordId(model: string, field: string, value: unknown): unknown {
        if (value === null || value === undefined) return value;
        if (field === "id") return new RecordId(model, value as string);
        const refTable = getFkTable(model, field);
        if (refTable && typeof value === "string") return new RecordId(refTable, value);
        return value;
      }

      /** Convert RecordId objects back to plain strings for the factory. */
      function fromRecord(value: unknown): unknown {
        if (value instanceof RecordId) return value.id as string;
        return value;
      }

      function transformOutputRecord(record: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(record)) {
          out[key] = fromRecord(value);
        }
        return out;
      }

      /** Prepare content for CREATE/UPDATE — convert FK strings to RecordId, strip `id`, omit nulls. */
      function transformInputRecord(
        data: Record<string, unknown>,
        model: string,
        stripId: boolean,
      ): Record<string, unknown> {
        const content: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
          if (stripId && key === "id") continue;
          if (value === null || value === undefined) continue; // SurrealDB option<T> uses NONE (omit)
          content[key] = toRecordId(model, key, value);
        }
        return content;
      }

      /** Build parameterized WHERE clause from CleanedWhere[]. */
      function buildWhere(
        where: CleanedWhere[],
        model: string,
      ): { clause: string; params: Record<string, unknown> } {
        const parts: string[] = [];
        const params: Record<string, unknown> = {};

        for (let i = 0; i < where.length; i++) {
          const w = where[i];
          const paramKey = `w${i}`;
          const value = toRecordId(model, w.field, w.value);
          params[paramKey] = value;

          const connector = i > 0 ? ` ${w.connector} ` : "";
          let expr: string;

          switch (w.operator) {
            case "eq":
              if (value === null) {
                expr = `${w.field} IS NONE`;
                delete params[paramKey];
              } else {
                expr = `${w.field} = $${paramKey}`;
              }
              break;
            case "ne":
              if (value === null) {
                expr = `${w.field} IS NOT NONE`;
                delete params[paramKey];
              } else {
                expr = `${w.field} != $${paramKey}`;
              }
              break;
            case "gt":
              expr = `${w.field} > $${paramKey}`;
              break;
            case "gte":
              expr = `${w.field} >= $${paramKey}`;
              break;
            case "lt":
              expr = `${w.field} < $${paramKey}`;
              break;
            case "lte":
              expr = `${w.field} <= $${paramKey}`;
              break;
            case "in":
              expr = `${w.field} IN $${paramKey}`;
              break;
            case "not_in":
              expr = `${w.field} NOT IN $${paramKey}`;
              break;
            case "contains":
              expr = `${w.field} CONTAINS $${paramKey}`;
              break;
            case "starts_with":
              expr = `string::starts_with(${w.field}, $${paramKey})`;
              break;
            case "ends_with":
              expr = `string::ends_with(${w.field}, $${paramKey})`;
              break;
            default:
              expr = `${w.field} = $${paramKey}`;
          }

          parts.push(`${connector}${expr}`);
        }

        return { clause: parts.join(""), params };
      }

      return {
        create: async ({ model, data }) => {
          const id = data.id as string;
          const record = new RecordId(model, id);
          const content = transformInputRecord(data, model, true);

          const [result] = await surreal.query<[Record<string, unknown>[]]>(
            `CREATE $record CONTENT $content RETURN AFTER;`,
            { record, content },
          );

          if (!result?.[0]) throw new Error(`Failed to create ${model} record`);
          return transformOutputRecord(result[0]) as any;
        },

        findOne: async ({ model, where }) => {
          const { clause, params } = buildWhere(where, model);

          const [results] = await surreal.query<[Record<string, unknown>[]]>(
            `SELECT * FROM ${model} WHERE ${clause} LIMIT 1;`,
            params,
          );

          const row = results?.[0];
          if (!row) return null; // better-auth contract: null, not undefined
          return transformOutputRecord(row) as any;
        },

        findMany: async ({ model, where, limit, sortBy, offset }) => {
          let query = `SELECT * FROM ${model}`;
          let params: Record<string, unknown> = {};

          if (where && where.length > 0) {
            const w = buildWhere(where, model);
            query += ` WHERE ${w.clause}`;
            params = w.params;
          }
          if (sortBy) {
            query += ` ORDER BY ${sortBy.field} ${sortBy.direction.toUpperCase()}`;
          }
          if (limit !== undefined) {
            query += ` LIMIT ${Number(limit)}`;
          }
          if (offset !== undefined) {
            query += ` START ${Number(offset)}`;
          }

          const [results] = await surreal.query<[Record<string, unknown>[]]>(
            `${query};`,
            params,
          );

          return (results ?? []).map(transformOutputRecord) as any[];
        },

        update: async ({ model, where, update: updateData }) => {
          const { clause, params } = buildWhere(where, model);
          const content = transformInputRecord(updateData as Record<string, unknown>, model, true);

          const [results] = await surreal.query<[Record<string, unknown>[]]>(
            `UPDATE ${model} MERGE $content WHERE ${clause} RETURN AFTER;`,
            { ...params, content },
          );

          const row = results?.[0];
          if (!row) return null;
          return transformOutputRecord(row) as any;
        },

        updateMany: async ({ model, where, update: updateData }) => {
          const { clause, params } = buildWhere(where, model);
          const content = transformInputRecord(updateData as Record<string, unknown>, model, true);

          const [results] = await surreal.query<[Record<string, unknown>[]]>(
            `UPDATE ${model} MERGE $content WHERE ${clause};`,
            { ...params, content },
          );

          return results?.length ?? 0;
        },

        delete: async ({ model, where }) => {
          const { clause, params } = buildWhere(where, model);
          await surreal.query(`DELETE FROM ${model} WHERE ${clause};`, params);
        },

        deleteMany: async ({ model, where }) => {
          const { clause, params } = buildWhere(where, model);
          const [results] = await surreal.query<[Record<string, unknown>[]]>(
            `DELETE FROM ${model} WHERE ${clause} RETURN BEFORE;`,
            params,
          );
          return results?.length ?? 0;
        },

        count: async ({ model, where }) => {
          let query: string;
          let params: Record<string, unknown> = {};

          if (where && where.length > 0) {
            const w = buildWhere(where, model);
            query = `SELECT count() FROM ${model} WHERE ${w.clause} GROUP ALL;`;
            params = w.params;
          } else {
            query = `SELECT count() FROM ${model} GROUP ALL;`;
          }

          const [results] = await surreal.query<[Array<{ count: number }>]>(query, params);
          return results?.[0]?.count ?? 0;
        },
      };
    },
  });
}
