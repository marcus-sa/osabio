import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");
const migrationGlob = new Bun.Glob("*.surql");

const BOOTSTRAP_SQL = `
DEFINE TABLE IF NOT EXISTS _migration SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON _migration TYPE string;
DEFINE FIELD IF NOT EXISTS applied_at ON _migration TYPE datetime;
`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

async function main() {
  const url = requireEnv("SURREAL_URL");
  const username = requireEnv("SURREAL_USERNAME");
  const password = requireEnv("SURREAL_PASSWORD");
  const namespace = requireEnv("SURREAL_NAMESPACE");
  const database = requireEnv("SURREAL_DATABASE");

  const surreal = new Surreal();
  await surreal.connect(url);
  await surreal.signin({ username, password });
  await surreal.use({ namespace, database });

  // Bootstrap migration tracking table
  await surreal.query(BOOTSTRAP_SQL);

  // Read migration files sorted alphabetically
  const files = (await Array.fromAsync(migrationGlob.scan(MIGRATIONS_DIR))).sort();

  if (files.length === 0) {
    console.log("No migration files found.");
    await surreal.close();
    return;
  }

  // Get already-applied migrations
  const [applied] = await surreal.query<[Array<{ name: string }>]>(
    "SELECT name FROM _migration;",
  );
  const appliedSet = new Set(applied.map((row) => row.name));

  const pending = files.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) {
    console.log("No pending migrations.");
    await surreal.close();
    return;
  }

  console.log(`${pending.length} pending migration(s):\n`);

  for (const file of pending) {
    const sql = await Bun.file(join(MIGRATIONS_DIR, file)).text();

    try {
      await surreal.query(sql);
    } catch (err) {
      console.error(`✗ Failed: ${file}`);
      console.error(err);
      await surreal.close();
      process.exit(1);
    }

    const record = new RecordId("_migration", file);
    await surreal.query("CREATE $record CONTENT { name: $name, applied_at: time::now() };", {
      record,
      name: file,
    });

    console.log(`✓ Applied: ${file}`);
  }

  console.log(`\nDone. ${pending.length} migration(s) applied.`);
  await surreal.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
