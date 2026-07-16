import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildBailongmaUi } from "../packages/bailongma-ui/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
buildBailongmaUi({ sourceRoot: path.join(root, "upstreams", "bailongma"), outputRoot: path.join(root, "build", "bailongma-ui") });
await import("../apps/web/server.mjs");
