import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const output = path.resolve(process.argv[2] ?? `./tmp/backups/bairui-${new Date().toISOString().replaceAll(":", "-")}.dump`);
fs.mkdirSync(path.dirname(output), { recursive: true });
execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", output, databaseUrl], { stdio: "inherit", timeout: 30 * 60_000 });
fs.chmodSync(output, 0o600);
console.log(output);
