import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "./args.mjs";

const options = parseArgs(process.argv.slice(2));
const directory = path.resolve(options.dir);
const output = path.resolve(options.out ?? `${directory}.tar.gz`);
execFileSync("tar", ["-czf", output, "-C", path.dirname(directory), path.basename(directory)], { stdio: "inherit" });
console.log(output);
