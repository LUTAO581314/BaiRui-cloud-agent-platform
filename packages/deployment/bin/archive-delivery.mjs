import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "./args.mjs";

const options = parseArgs(process.argv.slice(2));
const directory = path.resolve(options.dir ?? options.in);
const output = path.resolve(options.out ?? `${directory}.tar.gz`);
execFileSync("tar", ["-czf", output, "-C", path.dirname(directory), path.basename(directory)], { stdio: "inherit" });
console.log(JSON.stringify({ output, sha256: createHash("sha256").update(fs.readFileSync(output)).digest("hex") }, null, 2));
