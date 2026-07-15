import process from "node:process";
import { verifyDeliveryBundle } from "../bundle.mjs";
import { parseArgs } from "./args.mjs";

const options = parseArgs(process.argv.slice(2));
const result = verifyDeliveryBundle(options.dir ?? options.in);
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
