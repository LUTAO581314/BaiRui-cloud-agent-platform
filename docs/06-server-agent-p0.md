# Server Agent P0

This document defines the first runnable server-agent for bairui commercial
server management.

## 1. Scope

The P0 server-agent is an outbound heartbeat reporter. It is not a remote shell,
cloud provisioning daemon, or public management API.

Runtime flow:

```text
server-agent/index.mjs
  -> GET BAIRUI_HERMES_HEARTBEAT_URL
  -> validate payload with packages/server-protocol
  -> POST { heartbeat } to BAIRUI_PLATFORM_HEARTBEAT_URL
  -> use BAIRUI_SERVER_AGENT_TOKEN as optional Bearer token
```

## 2. Environment

- `BAIRUI_HERMES_HEARTBEAT_URL`: Hermes heartbeat URL. Defaults to
  `http://127.0.0.1:8787/platform/heartbeat`.
- `BAIRUI_PLATFORM_HEARTBEAT_URL`: platform heartbeat receive endpoint.
- `BAIRUI_SERVER_AGENT_TOKEN`: optional platform-issued bearer token.
- `BAIRUI_SERVER_AGENT_TIMEOUT_MS`: request timeout. Defaults to `10000`.

## 3. Run

```sh
npm run server-agent:once
```

Run the customer-server acceptance check after deployment:

```sh
npm run server-agent:acceptance
```

The command prints a JSON report with three checks:

- `hermes_heartbeat`;
- `platform_heartbeat_report`;
- `platform_server_registry`.

The report is accepted only when Hermes exposes a valid heartbeat, the platform
accepts the outbound heartbeat, and the platform registry lists the same server.

## 4. Security Boundary

The agent must not:

- open a public control port;
- execute arbitrary shell commands;
- upload root passwords, SSH private keys, database passwords, model keys, or
  connector tokens;
- upload prompts, chat history, files, Obsidian note bodies, memory content, or
  customer business data.

The platform receives operational metadata only: server identity, organization
identity, license status, Hermes version, health status, database readiness,
backup readiness, connector summary, error counters, and timestamp.

## 5. Commercial Use

This P0 agent is enough for:

- server registry last-seen updates;
- customer acceptance checks after assisted deployment;
- license and database readiness display;
- safe support triage without touching customer data.

Remote maintenance actions must remain future work and must use explicit
white-listed commands, approval, audit logging, and customer-visible status.

## 6. Platform Receive API

The first receive endpoint lives in `apps/web/server.mjs`:

```text
POST /api/server-heartbeat
GET  /api/servers
```

For P0, the registry is stored as local JSON through
`apps/web/server-registry.mjs`. This keeps the protocol testable before the
PostgreSQL schema and migrations are introduced.

## 7. PostgreSQL Target

The PostgreSQL target schema lives in `packages/db/schema.mjs` and starts with:

- `organizations`
- `licenses`
- `customer_servers`
- `server_heartbeats`

The JSON registry remains a local development fallback. Commercial deployments
should set `BAIRUI_PLATFORM_DATABASE_URL` so `apps/web` uses the PostgreSQL
storage adapter.

Run this before starting the production platform API:

```sh
npm run db:migrate
```
