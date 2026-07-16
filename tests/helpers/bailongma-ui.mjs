import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBailongmaUi } from "../../packages/bailongma-ui/build.mjs";
import { createBailongmaUi } from "../../packages/bailongma-ui/index.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `bairui-ui-${process.pid}-`));
export const bailongmaSourceRoot = path.join(repositoryRoot, "upstreams", "bailongma");
export const bailongmaBuildRoot = path.join(temporaryRoot, "bailongma-ui");
buildBailongmaUi({ sourceRoot: bailongmaSourceRoot, outputRoot: bailongmaBuildRoot });
process.once("exit", () => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

export function createTestBailongmaUi() {
  return createBailongmaUi({ root: bailongmaBuildRoot });
}
