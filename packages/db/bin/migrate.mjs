import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { fileURLToPath } from "node:url";

const connectionString = process.env.DATABASE_URL ?? process.env.BAIRUI_PLATFORM_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or BAIRUI_PLATFORM_DATABASE_URL is required");
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const client = new pg.Client({ connectionString, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined });
await client.connect();
try {
  for (const name of fs.readdirSync(migrationsDir).filter((item) => item.endsWith(".sql")).sort()) {
    await client.query(fs.readFileSync(path.join(migrationsDir, name), "utf8"));
    console.log(`Applied ${name}`);
  }
} finally {
  await client.end();
}
