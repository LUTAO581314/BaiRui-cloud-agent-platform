import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildBailongmaUi } from "../packages/bailongma-ui/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const result = buildBailongmaUi({
  sourceRoot: argument("--source", path.join(root, "upstreams", "bailongma")),
  outputRoot: argument("--out", path.join(root, "build", "bailongma-ui"))
});
process.stdout.write(`Built BaiLongma ${result.sourceVersion} UI at ${result.outputRoot}\n`);
