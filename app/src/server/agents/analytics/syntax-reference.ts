export const SURREALQL_SYNTAX_REFERENCE = `
## SurrealQL Syntax Reference

### SELECT Statement
\`\`\`
SELECT [ VALUE ] @fields [ AS @alias ]
  FROM [ ONLY ] @targets
  [ WHERE @conditions ]
  [ GROUP [ BY ] @field, ... ]
  [ ORDER [ BY ] @field [ ASC | DESC ], ... ]
  [ LIMIT [ BY ] @limit ]
  [ START [ AT ] @start ]
  [ FETCH @fields ... ]
  [ TIMEOUT @duration ]
  [ SPLIT [ ON ] @field, ... ]
;
\`\`\`

### Graph Traversal (Arrow Syntax)
SurrealDB uses arrow syntax for graph traversal — NOT SQL JOINs.

- Forward traversal: \`->edge_table->target_table\`
- Reverse traversal: \`<-edge_table<-source_table\`
- Bidirectional: \`<->edge_table<->table\`
- Projections on traversal: \`->edge->table.{field1, field2}\`
- Multi-hop: \`->edge1->table1->edge2->table2\`

Examples:
\`\`\`sql
-- Forward: tasks belonging to a project
SELECT ->belongs_to->project FROM task;

-- Reverse: tasks that belong to a project
SELECT <-belongs_to<-task FROM project;

-- Projection: get specific fields from traversal
SELECT ->belongs_to->project.{name, status} FROM task;

-- Multi-hop: features of projects in a workspace
SELECT ->has_project->project->has_feature->feature FROM workspace;
\`\`\`

### Time Literals & Functions
Use duration literals — NOT SQL INTERVAL syntax.

Duration literals: \`1s\`, \`5m\`, \`2h\`, \`1d\`, \`1w\`, \`2w\`, \`30d\`

\`\`\`sql
-- Correct: duration literal
WHERE created_at < time::now() - 2w

-- WRONG: SQL INTERVAL (does NOT exist in SurrealQL)
-- WHERE created_at < NOW() - INTERVAL '2 weeks'
\`\`\`

Time functions:
- \`time::now()\` — current datetime
- \`time::floor(datetime, duration)\` — round down
- \`time::day(datetime)\`, \`time::month(datetime)\`, \`time::year(datetime)\`

### Aggregate Functions
- \`count()\` — count rows in group
- \`math::sum(expr)\` — sum values
- \`math::mean(expr)\` — average
- \`math::min(expr)\`, \`math::max(expr)\`
- \`array::len(array)\` — array length

### Useful Built-in Functions
- \`record::table(id)\` — get table name from a record ID
- \`record::id(id)\` — get the ID portion of a record ID
- \`array::flatten(array)\` — flatten nested arrays
- \`array::distinct(array)\` — unique values
- \`array::len(array)\` — array length
- \`string::lowercase(str)\`, \`string::contains(str, substr)\`
- \`type::is::record(value)\` — check if value is a record

### Important Rules
1. Always include a \`LIMIT\` clause (default to 100 if not specified by user intent)
2. ORDER BY fields must appear in the SELECT projection
3. LIMIT must come before FETCH
4. Use \`$param\` syntax for parameterized values
5. For TYPE RELATION tables, edges are created with RELATE — they have \`in\` and \`out\` fields
6. \`IS NOT NONE\` checks for field existence (not \`IS NOT NULL\`)

### DO NOT USE (SQL constructs that do NOT exist in SurrealQL)
- \`JOIN\` — use arrow traversal instead
- \`INTERVAL\` — use duration literals (2w, 1d, etc.)
- \`HAVING\` — use WHERE with GROUP BY
- \`COALESCE\` / \`IFNULL\` — not available
- Subqueries in SELECT list — use LET variables instead
- \`AS\` for table aliases — not supported
- \`UNION\` / \`INTERSECT\` — use array functions or multiple queries
`;
