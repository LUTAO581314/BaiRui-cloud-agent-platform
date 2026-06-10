import { validateHeartbeat } from "../../packages/server-protocol/index.mjs";
import { acceptanceSqlParams, buildAcceptanceInsertSql, buildHeartbeatUpsertSql, buildMigrationSql, heartbeatSqlParams } from "../../packages/db/schema.mjs";
import { summarizeAcceptanceReport, summarizeServer, validateAcceptanceReport } from "./server-registry.mjs";

export async function createPgPool(databaseUrl) {
  const { Pool } = await import("pg");
  return new Pool({ connectionString: databaseUrl });
}

export function createPostgresRegistryStorage(pool) {
  return {
    kind: "postgres",
    async migrate() {
      await pool.query(buildMigrationSql());
    },
    async getReadiness() {
      const requiredTables = ["organizations", "licenses", "customer_servers", "server_heartbeats", "server_acceptance_reports"];
      const result = await pool.query(`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `, [requiredTables]);
      const existing = new Set(result.rows.map((row) => row.table_name));
      const checks = requiredTables.map((tableName) => ({
        name: tableName,
        passed: existing.has(tableName)
      }));
      return {
        ready: checks.every((check) => check.passed),
        storage_kind: "postgres",
        checks
      };
    },
    async recordHeartbeat(heartbeat, options = {}) {
      const validation = validateHeartbeat(heartbeat);
      if (!validation.valid) {
        return { accepted: false, status: 400, errors: validation.errors };
      }

      const receivedAt = options.receivedAt ?? new Date().toISOString();
      await pool.query(buildHeartbeatUpsertSql(), heartbeatSqlParams(heartbeat, receivedAt));
      return {
        accepted: true,
        status: 202,
        server: summarizeServer(heartbeat, receivedAt)
      };
    },
    async listServers() {
      const result = await pool.query(`
        select
          id as server_id,
          organization_id,
          license_id,
          license_status,
          hermes_version,
          health_status,
          database_status,
          backup_status,
          connector_status_summary,
          error_count_24h,
          brand_key,
          last_seen_at,
          last_heartbeat_at
        from customer_servers
        order by last_seen_at desc nulls last
      `);
      return result.rows;
    },
    async recordAcceptanceReport(report, options = {}) {
      const validation = validateAcceptanceReport(report);
      if (!validation.valid) {
        return { accepted: false, status: 400, errors: validation.errors };
      }

      const receivedAt = options.receivedAt ?? new Date().toISOString();
      await pool.query(buildAcceptanceInsertSql(), acceptanceSqlParams(report, receivedAt));
      return {
        accepted: true,
        status: 202,
        report: summarizeAcceptanceReport(report, receivedAt)
      };
    },
    async listAcceptanceReports(options = {}) {
      const params = [];
      const where = options.serverId ? "where server_id = $1" : "";
      if (options.serverId) {
        params.push(options.serverId);
      }
      const result = await pool.query(`
        select
          server_id,
          organization_id,
          license_id,
          accepted,
          check_count,
          failed_check_count,
          generated_at,
          received_at
        from server_acceptance_reports
        ${where}
        order by received_at desc
      `, params);
      return result.rows;
    }
  };
}
