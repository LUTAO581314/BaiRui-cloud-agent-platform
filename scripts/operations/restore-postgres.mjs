import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
const input = path.resolve(process.argv[2] ?? "");
if (!databaseUrl || process.env.BAIRUI_CONFIRM_RESTORE !== "RESTORE") throw new Error("DATABASE_URL and BAIRUI_CONFIRM_RESTORE=RESTORE are required");
if (!fs.existsSync(input)) throw new Error(`Backup does not exist: ${input}`);
execFileSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname", databaseUrl, input], { stdio: "inherit", timeout: 30 * 60_000 });
console.log("Restore completed");
