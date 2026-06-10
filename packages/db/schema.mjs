export const PLATFORM_SCHEMA_VERSION = "2026_06_10_001";

export const PLATFORM_SCHEMA_SQL = `
create table if not exists organizations (
    id text primary key,
    name text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists licenses (
    id text primary key,
    organization_id text not null references organizations(id),
    plan_code text not null,
    status text not null default 'active',
    features jsonb not null default '[]'::jsonb,
    limits jsonb not null default '{}'::jsonb,
    issued_at timestamptz,
    expires_at timestamptz,
    deployment_mode text not null default 'customer_vm',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists customer_servers (
    id text primary key,
    organization_id text not null references organizations(id),
    license_id text not null references licenses(id),
    brand_key text not null default 'bairui',
    hermes_version text not null default '',
    license_status text not null default 'missing_config',
    health_status text not null default 'unknown',
    database_status text not null default 'missing_config',
    backup_status text not null default 'not_configured',
    connector_status_summary jsonb not null default '{}'::jsonb,
    error_count_24h integer not null default 0,
    last_heartbeat_at timestamptz,
    last_seen_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists server_heartbeats (
    id bigserial primary key,
    server_id text not null references customer_servers(id),
    organization_id text not null references organizations(id),
    license_id text not null references licenses(id),
    protocol_version text not null,
    payload jsonb not null,
    received_at timestamptz not null default now()
);

create table if not exists server_acceptance_reports (
    id bigserial primary key,
    server_id text not null references customer_servers(id),
    organization_id text not null references organizations(id),
    license_id text not null references licenses(id),
    accepted boolean not null,
    check_count integer not null default 0,
    failed_check_count integer not null default 0,
    payload jsonb not null,
    generated_at timestamptz not null,
    received_at timestamptz not null default now()
);

create index if not exists idx_customer_servers_org on customer_servers(organization_id);
create index if not exists idx_customer_servers_last_seen on customer_servers(last_seen_at desc);
create index if not exists idx_server_heartbeats_server_received on server_heartbeats(server_id, received_at desc);
create index if not exists idx_server_acceptance_reports_server_received on server_acceptance_reports(server_id, received_at desc);
`.trim();

export function buildMigrationSql() {
  return `-- bairui platform schema ${PLATFORM_SCHEMA_VERSION}\n${PLATFORM_SCHEMA_SQL}\n`;
}

export function buildHeartbeatUpsertSql() {
  return `
insert into organizations (id, updated_at)
values ($2, now())
on conflict (id) do update set updated_at = excluded.updated_at;

insert into licenses (id, organization_id, plan_code, status, updated_at)
values ($3, $2, 'unknown', $4, now())
on conflict (id) do update set
    organization_id = excluded.organization_id,
    status = excluded.status,
    updated_at = excluded.updated_at;

insert into customer_servers (
    id,
    organization_id,
    license_id,
    brand_key,
    hermes_version,
    license_status,
    health_status,
    database_status,
    backup_status,
    connector_status_summary,
    error_count_24h,
    last_heartbeat_at,
    last_seen_at,
    updated_at
)
values ($1, $2, $3, $5, $6, $4, $7, $8, $9, $10::jsonb, $11, $12::timestamptz, $13::timestamptz, now())
on conflict (id) do update set
    organization_id = excluded.organization_id,
    license_id = excluded.license_id,
    brand_key = excluded.brand_key,
    hermes_version = excluded.hermes_version,
    license_status = excluded.license_status,
    health_status = excluded.health_status,
    database_status = excluded.database_status,
    backup_status = excluded.backup_status,
    connector_status_summary = excluded.connector_status_summary,
    error_count_24h = excluded.error_count_24h,
    last_heartbeat_at = excluded.last_heartbeat_at,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at;

insert into server_heartbeats (
    server_id,
    organization_id,
    license_id,
    protocol_version,
    payload,
    received_at
)
values ($1, $2, $3, $14, $15::jsonb, $13::timestamptz);
`.trim();
}

export function heartbeatSqlParams(heartbeat, receivedAt) {
  return [
    heartbeat.server_id,
    heartbeat.organization_id,
    heartbeat.license_id,
    heartbeat.license_status,
    heartbeat.brand_key,
    heartbeat.hermes_version,
    heartbeat.health_status,
    heartbeat.database_status,
    heartbeat.backup_status,
    JSON.stringify(heartbeat.connector_status_summary),
    heartbeat.error_count_24h,
    heartbeat.created_at,
    receivedAt,
    heartbeat.protocol_version,
    JSON.stringify(heartbeat)
  ];
}

export function buildAcceptanceInsertSql() {
  return `
insert into server_acceptance_reports (
    server_id,
    organization_id,
    license_id,
    accepted,
    check_count,
    failed_check_count,
    payload,
    generated_at,
    received_at
)
values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz);
`.trim();
}

export function acceptanceSqlParams(report, receivedAt) {
  return [
    report.server_id,
    report.organization_id,
    report.license_id,
    report.accepted,
    report.checks.length,
    report.checks.filter((check) => !check.passed).length,
    JSON.stringify(report),
    report.generated_at,
    receivedAt
  ];
}
