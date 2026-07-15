import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { issueLicense } from "../../license/license.mjs";
import { verifyDeliveryBundle, writeDeliveryBundle } from "../bundle.mjs";
import { parseArgs, deploymentInput } from "./args.mjs";

const options = parseArgs(process.argv.slice(2));
const privateKey = process.env.BAIRUI_LICENSE_PRIVATE_KEY?.replaceAll("\\n", "\n");
const licenseDocument = issueLicense({ licenseId: options["license-id"], organizationId: options["organization-id"], plan: options.plan ?? "starter", expiresAt: options["expires-at"] }, privateKey);
const output = path.resolve(options.out);
writeDeliveryBundle(output, { ...deploymentInput(options), licenseDocument });
const verification = verifyDeliveryBundle(output);
if (!verification.valid) throw new Error("Generated delivery bundle failed verification");
fs.writeFileSync(path.join(output, "release-ready"), `${new Date().toISOString()}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, verification }, null, 2));
