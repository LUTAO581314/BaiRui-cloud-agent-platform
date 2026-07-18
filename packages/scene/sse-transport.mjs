import { sceneEventMessage, scenePatch, sceneSnapshot } from "./projection.mjs";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function sceneEventCursor(url, request) {
  const query = Number(url.searchParams.get("after"));
  const header = Number(request.headers["last-event-id"]);
  return Math.max(0, Number.isSafeInteger(query) ? query : 0, Number.isSafeInteger(header) ? header : 0);
}

export async function streamSceneEvents({ response, repository, ownerScope, scene, afterRevision = 0, pollIntervalMs = 1000 }) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff"
  });
  response.write("retry: 3000\n\n");
  let cursor = Math.max(0, Number(afterRevision) || 0);
  let open = true;
  let lastHeartbeat = Date.now();
  response.on("close", () => { open = false; });

  const emit = (event, data, revision) => {
    if (!open || response.writableEnded) return;
    response.write(`id: ${revision}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const emitSnapshot = (value) => {
    emit("scene", sceneEventMessage(sceneSnapshot(value, ownerScope)), value.revision);
    cursor = value.revision;
  };

  if (cursor === 0 || cursor > scene.revision) emitSnapshot(scene);
  while (open && !response.writableEnded) {
    const events = await repository.listAgentSceneEvents({
      organizationId: ownerScope.organization_id,
      userId: ownerScope.user_id,
      agentId: ownerScope.agent_id,
      sceneId: scene.sceneId,
      afterRevision: cursor,
      limit: 100
    });
    if (events.length) {
      for (const event of events) {
        if (event.baseRevision !== cursor) {
          const latest = await repository.getAgentScene({
            organizationId: ownerScope.organization_id,
            userId: ownerScope.user_id,
            agentId: ownerScope.agent_id,
            sceneId: scene.sceneId
          });
          if (latest) emitSnapshot(latest);
          break;
        }
        emit("scene.patch", sceneEventMessage(scenePatch(event, ownerScope)), event.revision);
        cursor = event.revision;
      }
    } else if (Date.now() - lastHeartbeat >= 15_000) {
      response.write(`: keepalive ${cursor}\n\n`);
      lastHeartbeat = Date.now();
    }
    if (open && !response.writableEnded) await sleep(pollIntervalMs);
  }
  if (!response.writableEnded) response.end();
}
