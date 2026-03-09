import { createAdapterFactory, type CleanedWhere } from "better-auth/adapters";
import { RecordId, type Surreal } from "surrealdb";

/**
 * Custom SurrealDB v2 adapter for better-auth.
 *
 * Uses the project's existing Surreal connection (SDK v2) instead of creating
 * its own. Field names arrive pre-mapped by the factory for configured core
 * models (user/person, session, account, verification). Plugin models (OAuth
 * tables) use better-auth's default camelCase naming which matches the DB schema.
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

      function getFkTable(table: string, field: string): string | undefined {
        return fkMap.get(table)?.get(field);
      }

      /** Convert string FK values to RecordId for writes/where clauses. */
      function toRecordId(table: string, field: string, value: unknown): unknown {
        if (value === null || value === undefined) return value;
        if (field === "id") return new RecordId(table, value as string);
        const refTable = getFkTable(table, field);
        if (refTable && typeof value === "string") return new RecordId(refTable, value);
        return value;
      }

      /** Convert RecordId objects back to plain strings and SurrealDB Datetime to native Date for the factory. */
      function fromRecord(value: unknown): unknown {
        if (value instanceof RecordId) return value.id as string;
        // SurrealDB SDK returns Datetime objects (not native Date) for datetime fields.
        // better-auth expects native Date instances (e.g. JWT adapter calls .getTime()).
        if (
          value !== null &&
          typeof value === "object" &&
          !(value instanceof Date) &&
          typeof (value as any).toISOString === "function"
        ) {
          return new Date((value as any).toISOString());
        }
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
        table: string,
        stripId: boolean,
      ): Record<string, unknown> {
        const content: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
          if (stripId && key === "id") continue;
          if (value === null || value === undefined) continue; // SurrealDB option<T> uses NONE (omit)
          content[key] = toRecordId(table, key, value);
        }
        return content;
      }

      /** Build parameterized WHERE clause from CleanedWhere[]. */
      function buildWhere(
        where: CleanedWhere[],
        table: string,
      ): { clause: string; params: Record<string, unknown> } {
        const parts: string[] = [];
        const params: Record<string, unknown> = {};

        for (let i = 0; i < where.length; i++) {
          const w = where[i];
          const paramKey = `w${i}`;
          const value = toRecordId(table, w.field, w.value);
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
          const table = getModelName(model);
          const id = data.id as string;
          const record = new RecordId(table, id);
          const content = transformInputRecord(data, table, true);

          const [result] = await surreal.query<[Record<string, unknown>[]]>(
            `CREATE $record CONTENT $content RETURN AFTER;`,
            { record, content },
          );

          if (!result?.[0]) throw new Error(`Failed to create ${table} record`);
          return transformOutputRecord(result[0]) as any;
        },

        findOne: async ({ model, where }) => {
          const table = getModelName(model);
          const { clause, params } = buildWhere(where, table);

          const [results] = await surreal.query<[Record<string, unknown>[]]>(
            `SELECT * FROM ${table} WHERE ${clause} LIMIT 1;`,
            params,
          );

          const row = results?.[0];
          if (!row) return null; // better-auth contract: null, not undefined
          return transformOutputRecord(row) as any;
        },

        findMany: async ({ model, where, limit, sortBy, offset }) => {
          const table = getModelName(model);
          let query = `SELECT * FROM ${table}`;
          let params: Record<string, unknown> = {};

          if (where && where.length > 0) {
            const w = buildWhere(where, table);
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

          return (results ?? []).map((r) => transformOutputRecord(r)) as any[];
        },

        update: async ({ model, where, update: updateData }) => {
          const table = getModelName(model);
          const { clause, params } = buildWhere(where, table);
          const content = transformInputRecord(updateData as Record<string, unknown>, table, true);

          const [results] = await surreal.query<[Record<string, unknown>[]]>(
            `UPDATE ${table} MERGE $content WHERE ${clause} RETURN AFTER;`,
            { ...params, content },
          );

          const row = results?.[0];
          if (!row) return null;
          return transformOutputRecord(row) as any;
        },

        updateMany: async ({ model, where, update: updateData }) => {
          const table = getModelName(model);
          const { clause, params } = buildWhere(where, table);
          const content = transformInputRecord(updateData as Record<string, unknown>, table, true);

          const [results] = await surreal.query<[Record<string, unknown>[]]>(
            `UPDATE ${table} MERGE $content WHERE ${clause};`,
            { ...params, content },
          );

          return results?.length ?? 0;
        },

        delete: async ({ model, where }) => {
          const table = getModelName(model);
          const { clause, params } = buildWhere(where, table);
          await surreal.query(`DELETE FROM ${table} WHERE ${clause};`, params);
        },

        deleteMany: async ({ model, where }) => {
          const table = getModelName(model);
          const { clause, params } = buildWhere(where, table);
          const [results] = await surreal.query<[Record<string, unknown>[]]>(
            `DELETE FROM ${table} WHERE ${clause} RETURN BEFORE;`,
            params,
          );
          return results?.length ?? 0;
        },

        count: async ({ model, where }) => {
          const table = getModelName(model);
          let query: string;
          let params: Record<string, unknown> = {};

          if (where && where.length > 0) {
            const w = buildWhere(where, table);
            query = `SELECT count() FROM ${table} WHERE ${w.clause} GROUP ALL;`;
            params = w.params;
          } else {
            query = `SELECT count() FROM ${table} GROUP ALL;`;
          }

          const [results] = await surreal.query<[Array<{ count: number }>]>(query, params);
          return results?.[0]?.count ?? 0;
        },
      };
    },
  });
}
