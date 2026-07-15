import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
for (const name of fs.readdirSync(directory).filter((item) => item.endsWith(".sql")).sort()) {
  process.stdout.write(`-- ${name}\n${fs.readFileSync(path.join(directory, name), "utf8")}\n`);
}
