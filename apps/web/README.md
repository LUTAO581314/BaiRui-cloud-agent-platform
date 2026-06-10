# MOXI Web Platform

This directory will contain the MOXI commercial web application:

- public website;
- customer console;
- admin console;
- deployment wizard;
- license management;
- server registry;
- support tickets;
- release and upgrade views.

Recommended stack:

- Next.js;
- TypeScript;
- Tailwind CSS;
- shadcn/ui;
- PostgreSQL;
- Prisma or Drizzle;
- Playwright.

This app must not contain Hermes runtime internals. It integrates with Hermes
through license files, server registration, release metadata, health summaries,
and support bundle workflows.

## P0 API

The first runnable platform API is implemented with Node standard library in
`apps/web/server.mjs`.

Endpoints:

- `GET /health`: platform API health check.
- `GET /ready`: deployment readiness check for storage mode, required tables,
  and server-agent token configuration.
- `POST /api/server-heartbeat`: receive outbound heartbeat from server-agent.
- `GET /api/servers`: list the latest known server registry state.
- `POST /api/server-acceptance`: receive customer deployment acceptance report.
- `GET /api/server-acceptance`: list acceptance report summaries, optionally
  filtered by `server_id`.

Environment variables:

- `BAIRUI_PLATFORM_PORT`: local API port, default `8788`.
- `BAIRUI_PLATFORM_DATABASE_URL`: PostgreSQL connection string. When set, the
  API uses PostgreSQL storage.
- `BAIRUI_SERVER_REGISTRY_PATH`: local JSON registry path, default
  `./data/platform/server-registry.json`. Used when database URL is missing.
- `BAIRUI_SERVER_AGENT_TOKEN`: optional bearer token required for heartbeat
  and acceptance ingestion when set.

Run locally:

```sh
npm run platform:dev
```

The API keeps a JSON fallback for local development. Commercial deployments
should set `BAIRUI_PLATFORM_DATABASE_URL` and run the PostgreSQL migration from
`packages/db`.

Initialize PostgreSQL before starting the platform API:

```sh
npm run db:migrate
```

After startup, verify readiness:

```sh
curl http://127.0.0.1:8788/ready
```
