import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { issueLicense } from "../license.mjs";

function args(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) continue;
    const [key, inline] = values[index].slice(2).split("=", 2);
    result[key] = inline ?? values[++index];
  }
  return result;
}

const options = args(process.argv.slice(2));
const privateKey = process.env.BAIRUI_LICENSE_PRIVATE_KEY?.replaceAll("\\n", "\n");
const document = issueLicense({ licenseId: options["license-id"], organizationId: options["organization-id"], plan: options.plan, features: options.features?.split(",").filter(Boolean), expiresAt: options["expires-at"] }, privateKey);
const output = path.resolve(options.out ?? `./tmp/licenses/${document.payload.licenseId}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(output);
