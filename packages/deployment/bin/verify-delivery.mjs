import process from "node:process";
import { verifyDeliveryBundle } from "../bundle.mjs";
import { parseArgs } from "./args.mjs";

const result = verifyDeliveryBundle(parseArgs(process.argv.slice(2)).dir);
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
