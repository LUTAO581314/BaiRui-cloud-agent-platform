import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import pg from "pg";
import { fileURLToPath } from "node:url";

const connectionString = process.env.DATABASE_URL ?? process.env.BAIRUI_PLATFORM_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or BAIRUI_PLATFORM_DATABASE_URL is required");
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const client = new pg.Client({ connectionString, ssl: process.env.BAIRUI_DATABASE_SSL === "1" ? { rejectUnauthorized: true } : undefined });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query("SELECT pg_advisory_lock(hashtext('bairui-schema-migrations'))");
  for (const name of fs.readdirSync(migrationsDir).filter((item) => item.endsWith(".sql")).sort()) {
    const source = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const { rows } = await client.query("SELECT checksum FROM schema_migrations WHERE name=$1", [name]);
    if (rows[0]) {
      if (rows[0].checksum !== checksum) throw new Error(`Applied migration checksum changed: ${name}`);
      console.log(`Verified ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(source);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)", [name, checksum]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('bairui-schema-migrations'))").catch(() => undefined);
  await client.end();
}
