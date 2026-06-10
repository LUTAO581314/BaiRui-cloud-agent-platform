# Platform Database Package

This package will own the commercial platform database schema and migration
helpers.

Initial domains:

- users;
- organizations;
- memberships;
- plans;
- subscriptions;
- orders;
- licenses;
- customer servers;
- server heartbeats;
- deployments;
- releases;
- support tickets;
- diagnostic uploads;
- audit logs.

The platform database must not store customer business chat content, Obsidian
vault text, model API keys, or connector tokens by default.

## P0 Schema

`schema.mjs` defines the first PostgreSQL schema for the commercial platform:

- `organizations`
- `licenses`
- `customer_servers`
- `server_heartbeats`
- `server_acceptance_reports`

Print the migration SQL:

```sh
npm run db:migration:print
```

Run the migration against PostgreSQL:

```sh
BAIRUI_PLATFORM_DATABASE_URL=postgres://user:pass@host:5432/bairui npm run db:migrate
```

The first production path is:

```text
server-agent
  -> POST /api/server-heartbeat
  -> validate heartbeat
  -> upsert customer_servers
  -> append server_heartbeats
  -> POST /api/server-acceptance
  -> append server_acceptance_reports
```

The `apps/web` API uses PostgreSQL when `BAIRUI_PLATFORM_DATABASE_URL` is set
and falls back to JSON registry storage for local development.
