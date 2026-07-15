import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const requiredTables = [
  "agents", "agent_memberships", "agent_runtimes", "agent_components",
  "heartbeats", "telemetry_events", "usage_rollups", "alerts",
  "secret_references", "control_deployments", "control_commands",
  "config_revisions", "desired_states"
];
const requiredAgentColumns = ["owner_user_id", "initialization_status", "desired_runtime_state"];
const client = new pg.Client({ connectionString });
await client.connect();
try {
  const { rows: tableRows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  const tables = new Set(tableRows.map((row) => row.table_name));
  for (const table of requiredTables) if (!tables.has(table)) throw new Error(`Missing PostgreSQL table: ${table}`);
  const { rows: columnRows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agents'");
  const columns = new Set(columnRows.map((row) => row.column_name));
  for (const column of requiredAgentColumns) if (!columns.has(column)) throw new Error(`Missing agents column: ${column}`);
  const { rows: actionRows } = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='control_commands_action_check'");
  const actionConstraint = actionRows[0]?.definition ?? "";
  for (const action of ["deployment.provision", "deployment.suspend", "deployment.delete", "credential.revoke"]) {
    if (!actionConstraint.includes(action)) throw new Error(`Missing control action in PostgreSQL constraint: ${action}`);
  }
  console.log("PostgreSQL schema check passed.");
} finally {
  await client.end();
}
