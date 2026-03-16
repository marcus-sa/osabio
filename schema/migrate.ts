import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

// --- Admin seed types and pure functions (exported for testing) ---

export type AdminSeedConfig = {
  email: string;
  password: string;
};

export function parseSeedConfig(
  env: Record<string, string | undefined>,
): AdminSeedConfig | undefined {
  const selfHosted = env.SELF_HOSTED?.trim().toLowerCase() === "true";
  if (!selfHosted) return undefined;

  const email = env.ADMIN_EMAIL?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!email || email.length === 0) return undefined;
  if (!password || password.length === 0) return undefined;

  return { email, password };
}

export function buildPersonRecord(
  email: string,
  now: Date,
): {
  name: string;
  contact_email: string;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
} {
  return {
    name: "Admin",
    contact_email: email,
    email_verified: true,
    created_at: now,
    updated_at: now,
  };
}

export function buildAccountRecord(
  personId: string,
  hashedPassword: string,
  now: Date,
): {
  account_id: string;
  provider_id: string;
  password: string;
  created_at: Date;
  updated_at: Date;
} {
  return {
    account_id: personId,
    provider_id: "credential",
    password: hashedPassword,
    created_at: now,
    updated_at: now,
  };
}

async function seedAdminUser(
  surreal: Surreal,
  config: AdminSeedConfig,
): Promise<void> {
  const [existing] = await surreal.query<[Array<{ id: RecordId }>]>(
    "SELECT id FROM person WHERE contact_email = $email LIMIT 1;",
    { email: config.email },
  );

  if (existing.length > 0) {
    console.log(`Admin user already exists, skipping seed`);
    return;
  }

  const hashedPassword = await Bun.password.hash(config.password);
  const now = new Date();

  const personContent = buildPersonRecord(config.email, now);
  const [createdPersons] = await surreal.query<[Array<{ id: RecordId }>]>(
    "CREATE person CONTENT $content;",
    { content: personContent },
  );
  const personRecord = createdPersons[0];
  const personId = personRecord.id.id as string;

  const accountContent = buildAccountRecord(personId, hashedPassword, now);
  await surreal.query(
    "CREATE $record CONTENT $content;",
    {
      record: new RecordId("account", personId),
      content: {
        ...accountContent,
        person_id: personRecord.id,
      },
    },
  );

  console.log(`Admin user seeded: ${config.email}`);
}

async function maybeSeedAdmin(surreal: Surreal): Promise<void> {
  const seedConfig = parseSeedConfig(process.env);
  if (!seedConfig) return;
  await seedAdminUser(surreal, seedConfig);
}

// --- Migration runner ---

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
    await maybeSeedAdmin(surreal);
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
    await maybeSeedAdmin(surreal);
    await surreal.close();
    return;
  }

  console.log(`${pending.length} pending migration(s):\n`);

  for (const file of pending) {
    const sql = await Bun.file(join(MIGRATIONS_DIR, file)).text();

    try {
      const stream = surreal.query(sql).stream();
      let stmtIndex = 0;
      for await (const frame of stream) {
        if ((frame as any).status === "ERR") {
          console.error(`✗ Failed: ${file} (statement ${stmtIndex})`);
          console.error(`  → ${(frame as any).result}`);
          await surreal.close();
          process.exit(1);
        }
        stmtIndex++;
      }
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
  await maybeSeedAdmin(surreal);
  await surreal.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
