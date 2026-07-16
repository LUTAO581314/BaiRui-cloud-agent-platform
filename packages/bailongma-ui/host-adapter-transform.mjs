const HOST_GUARD = `const hostAdapter = window.BairuiHostAdapter;
if (!hostAdapter) throw new Error("BairuiHostAdapter is unavailable");`;

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`BaiLongma ${label} patch expected one anchor, found ${count}`);
  return source.replace(anchor, replacement);
}

export function transformBailongmaHostApp(source) {
  let output = replaceOnce(source, "renderBrainUiApp(document.body);", `${HOST_GUARD}\nrenderBrainUiApp(document.body);`, "host initialization");
  output = replaceOnce(output, "const res = await fetch(`${API}/agent-profile`);", "const res = await hostAdapter.agentProfile();", "Agent profile");
  output = replaceOnce(output, "const rows = await fetch(`${API}/memories?limit=120`).then(r => r.json());", "const rows = await hostAdapter.memories({ limit: 120 }).then(r => r.json());", "memory graph");
  return replaceOnce(output, "const es = new EventSource(`${API}/events`);", "const es = hostAdapter.openEvents();", "event stream");
}

export function transformBailongmaHostChat(source) {
  let output = `${HOST_GUARD}\n\n${source}`;
  output = replaceOnce(output, "const res = await fetch(`${apiBase}/conversations?limit=${maxHistory}`);", "const res = await hostAdapter.conversations({ limit: maxHistory });", "conversation history");
  return replaceOnce(output, "const resp = await fetch(`${apiBase}/message`, {", "const resp = await hostAdapter.sendMessage({", "message send");
}

export function transformBailongmaHostVoiceWake(source) {
  return replaceOnce(source, "try { es = new EventSource('/events'); } catch { return; }", "try { es = window.BairuiHostAdapter?.openEvents(); if (!es) return; } catch { return; }", "voice event stream");
}
