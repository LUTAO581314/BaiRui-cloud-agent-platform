import process from "node:process";
import { execFileSync } from "node:child_process";

const image = process.argv[2];
if (!image || !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+:[A-Za-z0-9_.-]+$/i.test(image)) throw new Error("Pass a versioned GHCR image reference");
const env = { ...process.env, BAIRUI_PLATFORM_IMAGE: image };
execFileSync("docker", ["compose", "-f", "infra/docker-compose.yml", "pull", "platform"], { stdio: "inherit", env });
execFileSync("docker", ["compose", "-f", "infra/docker-compose.yml", "up", "-d", "--no-deps", "platform"], { stdio: "inherit", env });
console.log(`Rolled platform back to ${image}`);
