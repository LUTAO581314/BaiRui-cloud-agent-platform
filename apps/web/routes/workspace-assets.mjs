import { json } from "../http.mjs";

const ASSET_PREFIX = "/assets/";
const SCRIPT_NAME = /^bairui-workspace(?:-[a-z][a-z0-9-]*)?\.js$/;

export function createWorkspaceAssetRoutes({ scripts, authenticate }) {
  const assets = new Map(Object.entries(scripts ?? {}).filter(([name]) => SCRIPT_NAME.test(name)));
  return async function routeWorkspaceAssets({ method, url, request, response }) {
    if (method !== "GET" || !url.pathname.startsWith(ASSET_PREFIX)) return false;
    const name = url.pathname.slice(ASSET_PREFIX.length);
    if (!SCRIPT_NAME.test(name)) return false;
    const script = assets.get(name);
    if (!script) {
      json(response, 404, { error: "not_found" });
      return true;
    }
    if (!await authenticate(request)) {
      json(response, 401, { error: "authentication_required" });
      return true;
    }
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "private, max-age=300"
    });
    response.end(script);
    return true;
  };
}
