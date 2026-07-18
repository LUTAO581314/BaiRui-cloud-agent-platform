import { json } from "../http.mjs";

export function createWorkspaceAssetRoutes({ skillsScript }) {
  return async function routeWorkspaceAssets({ method, url, response }) {
    if (method !== "GET" || url.pathname !== "/assets/bairui-workspace-skills.js") return false;
    if (!skillsScript) {
      json(response, 404, { error: "not_found" });
      return true;
    }
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=300"
    });
    response.end(skillsScript);
    return true;
  };
}
