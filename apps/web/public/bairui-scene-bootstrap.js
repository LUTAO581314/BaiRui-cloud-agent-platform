// The BaiLongma declarative scene shell is disabled until Hermes exposes the
// corresponding UI projection port. This overlay prevents a second Agent core
// or an unauthenticated WebSocket from being introduced by the UI import.
export function bootstrapScene() {
  return { shell: null, client: null };
}
