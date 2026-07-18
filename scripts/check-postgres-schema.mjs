import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const requiredTables = [
  "schema_migrations",
  "agents", "agent_memberships", "agent_runtimes", "agent_components",
  "heartbeats", "telemetry_events", "usage_rollups", "alerts",
  "secret_references", "control_deployments", "control_commands",
  "config_revisions", "desired_states", "observations", "control_approvals", "control_events",
  "control_outbox", "control_dead_letters", "release_manifests",
  "control_secret_references", "control_command_leases", "command_verifications",
  "control_idempotency_records", "control_audit_events",
  "test_runs", "backup_records", "upstream_candidates", "server_credentials",
  "agent_runtime_credentials", "machine_request_nonces", "command_receipts",
  "agent_skill_preferences", "agent_channel_bindings", "agent_hotspot_bookmarks",
  "agent_runs", "agent_authorizations", "memory_projection_outbox",
  "channel_worker_credentials", "channel_conversations", "channel_inbox", "channel_outbox",
  "channel_delivery_receipts", "channel_health_observations", "channel_dead_letters",
  "provider_channels", "model_policies", "data_retention_policies",
  "sensitive_access_grants", "sensitive_access_events", "backup_restore_runs", "retention_runs",
  "agent_resource_samples", "agent_container_resource_samples"
];
const requiredAgentColumns = ["owner_user_id", "initialization_status", "desired_runtime_state"];
const requiredRuntimeColumns = ["endpoint_ref", "route_updated_at"];
const requiredObsidianColumns = ["agent_id", "memory_kind", "importance", "hermes_target", "source_ref", "revision", "hermes_sync_status", "hermes_synced_revision", "hermes_synced_at"];
const requiredMemoryOutboxColumns = ["organization_id", "user_id", "agent_id", "reason", "state", "attempts", "available_at", "lease_token", "lease_expires_at", "last_error_code", "result_summary"];
const requiredChannelBindingColumns = ["connection_generation", "capabilities", "adapter_version", "last_health_at", "last_inbound_at", "last_outbound_at"];
const requiredChannelInboxColumns = ["organization_id", "user_id", "agent_id", "binding_id", "external_message_id", "state", "attempts", "lease_token", "lease_expires_at"];
const requiredChannelOutboxColumns = ["organization_id", "user_id", "agent_id", "binding_id", "inbox_id", "state", "attempts", "worker_id", "lease_token", "lease_expires_at"];
const requiredBackupColumns = ["expired_at"];
const requiredDesiredStateColumns = ["organization_id", "agent_id", "server_id", "idempotency_key", "sequence", "state", "lifecycle_status", "backup_id", "modules", "valid_from", "expires_at"];
const requiredObservationColumns = ["organization_id", "agent_id", "server_id", "idempotency_key", "sequence", "source_identity", "modules", "redaction_status", "freshness", "freshness_seconds"];
const requiredControlCommandColumns = ["secret_refs", "verification_state", "completion_candidate_at", "finalized_at"];
const requiredReceiptColumns = ["lease_id", "idempotency_key", "event_sequence", "observed_at", "completed_at", "result_ref", "endpoint_ref", "source_identity", "observation_version", "error_ref", "completion_candidate"];
const requiredControlOutboxColumns = ["organization_id", "deployment_id", "event_id", "idempotency_key", "state", "max_attempts", "lease_token_hash", "lease_expires_at"];
const client = new pg.Client({ connectionString });
await client.connect();
try {
  const { rows: tableRows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  const tables = new Set(tableRows.map((row) => row.table_name));
  for (const table of requiredTables) if (!tables.has(table)) throw new Error(`Missing PostgreSQL table: ${table}`);
  const { rows: columnRows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agents'");
  const columns = new Set(columnRows.map((row) => row.column_name));
  for (const column of requiredAgentColumns) if (!columns.has(column)) throw new Error(`Missing agents column: ${column}`);
  const { rows: runtimeColumnRows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_runtimes'");
  const runtimeColumns = new Set(runtimeColumnRows.map((row) => row.column_name));
  for (const column of requiredRuntimeColumns) if (!runtimeColumns.has(column)) throw new Error(`Missing agent_runtimes column: ${column}`);
  const { rows: obsidianColumnRows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='obsidian_notes'");
  const obsidianColumns = new Set(obsidianColumnRows.map((row) => row.column_name));
  for (const column of requiredObsidianColumns) if (!obsidianColumns.has(column)) throw new Error(`Missing obsidian_notes column: ${column}`);
  const { rows: memoryOutboxColumnRows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='memory_projection_outbox'");
  const memoryOutboxColumns = new Set(memoryOutboxColumnRows.map((row) => row.column_name));
  for (const column of requiredMemoryOutboxColumns) if (!memoryOutboxColumns.has(column)) throw new Error(`Missing memory_projection_outbox column: ${column}`);
  for (const [table, requiredColumns] of [["agent_channel_bindings", requiredChannelBindingColumns], ["channel_inbox", requiredChannelInboxColumns], ["channel_outbox", requiredChannelOutboxColumns]]) {
    const { rows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table]);
    const columns = new Set(rows.map((row) => row.column_name));
    for (const column of requiredColumns) if (!columns.has(column)) throw new Error(`Missing ${table} column: ${column}`);
  }
  const { rows: backupColumnRows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='backup_records'");
  const backupColumns = new Set(backupColumnRows.map((row) => row.column_name));
  for (const column of requiredBackupColumns) if (!backupColumns.has(column)) throw new Error(`Missing backup_records column: ${column}`);
  for (const [table, requiredColumns] of [["desired_states", requiredDesiredStateColumns], ["observations", requiredObservationColumns], ["control_commands", requiredControlCommandColumns], ["command_receipts", requiredReceiptColumns], ["control_outbox", requiredControlOutboxColumns]]) {
    const { rows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table]);
    const columns = new Set(rows.map((row) => row.column_name));
    for (const column of requiredColumns) if (!columns.has(column)) throw new Error(`Missing ${table} column: ${column}`);
  }
  const { rows: actionRows } = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='control_commands_action_check'");
  const actionConstraint = actionRows[0]?.definition ?? "";
  for (const action of ["deployment.provision", "deployment.suspend", "deployment.delete", "credential.revoke", "config.apply-user", "backup.restore", "backup.expire"]) {
    if (!actionConstraint.includes(action)) throw new Error(`Missing control action in PostgreSQL constraint: ${action}`);
  }
  const { rows: nonceConstraintRows } = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='machine_request_nonces_credential_type_check'");
  if (!(nonceConstraintRows[0]?.definition ?? "").includes("channel-worker")) throw new Error("Channel Worker machine nonce type is missing");
  const { rows: authorityFunctionRows } = await client.query("SELECT proname FROM pg_proc WHERE proname IN ('bairui_control_json_is_safe','bairui_reject_unsafe_control_json','bairui_secret_refs_are_opaque','bairui_prepare_desired_state_revision')");
  if (new Set(authorityFunctionRows.map((row) => row.proname)).size !== 4) throw new Error("Control Authority persistence functions are missing");
  const { rows: authorityTriggerRows } = await client.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('desired_states_prepare_revision','control_commands_safe_payload','command_receipts_safe_payload','control_outbox_safe_payload','control_audit_events_safe_payload')");
  if (new Set(authorityTriggerRows.map((row) => row.tgname)).size !== 5) throw new Error("Control Authority persistence triggers are missing");
  console.log("PostgreSQL schema check passed.");
} finally {
  await client.end();
}
