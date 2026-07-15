import fs from "node:fs";
import process from "node:process";
import { writeDeliveryBundle } from "../bundle.mjs";
import { parseArgs, deploymentInput } from "./args.mjs";

const options = parseArgs(process.argv.slice(2));
const licenseDocument = options.license ? JSON.parse(fs.readFileSync(options.license, "utf8")) : undefined;
console.log(JSON.stringify(writeDeliveryBundle(options.out, { ...deploymentInput(options), licenseDocument }), null, 2));
