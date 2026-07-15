import process from "node:process";
import { createDeploymentConfig } from "../bundle.mjs";
import { parseArgs, deploymentInput } from "./args.mjs";

console.log(JSON.stringify(createDeploymentConfig(deploymentInput(parseArgs(process.argv.slice(2)))), null, 2));
