# Hermes Platform Contract

This document defines the boundary between Hermes and MOXI-cloud-agent.

## 1. Ownership

Hermes owns:

- Agent runtime;
- model gateway;
- tasks;
- approvals;
- tools;
- PostgreSQL production state;
- Obsidian writes;
- connectors;
- customer-side health.

MOXI-cloud-agent owns:

- website;
- customer console;
- admin console;
- license;
- plans;
- orders;
- deployment wizard;
- server registry;
- release metadata;
- support workflow.

## 2. Platform To Hermes

The platform may provide:

- license file;
- server_id;
- release metadata;
- deployment template;
- documentation links;
- support upload endpoint.

## 3. Hermes To Platform

Hermes may report:

- server_id;
- license_id;
- Hermes version;
- deployment mode;
- health status;
- backup status;
- connector summary;
- error count;
- last seen time.

### 3.1 P0 Heartbeat Contract

The P0 heartbeat is implemented in `packages/server-protocol`.

Current protocol version:

```text
2026-06-10.p0
```

Payload:

```json
{
  "protocol_version": "2026-06-10.p0",
  "server_id": "srv_xxx",
  "organization_id": "org_xxx",
  "license_id": "lic_xxx",
  "license_status": "valid",
  "hermes_version": "0.1.0",
  "health_status": "ok",
  "database_status": "ready",
  "backup_status": "not_configured",
  "connector_status_summary": {},
  "error_count_24h": 0,
  "brand_key": "bairui",
  "created_at": "2026-06-10T00:00:00.000Z"
}
```

The platform must validate this payload before storing server state. The
customer server should send it outbound to the platform; the platform must not
require an unauthenticated inbound control port on the customer server.

### 3.2 P0 Acceptance Report Contract

After assisted deployment, `server-agent:acceptance` sends a JSON report to:

```text
POST /api/server-acceptance
```

The report contains server identity, license identity, generated timestamp,
overall accepted status, and check summaries. It must not contain prompts,
chat history, files, Obsidian note bodies, model keys, connector tokens,
passwords, private keys, or unrestricted logs.

The platform stores acceptance summaries for customer delivery evidence and
support audit. Operators can query:

```text
GET /api/server-acceptance?server_id=srv_xxx
```

## 4. Default Data Boundary

Hermes must not upload by default:

- chat content;
- Obsidian vault content;
- customer files;
- model API keys;
- connector tokens;
- database dumps;
- private logs with secrets.

Diagnostic bundles must be customer-triggered and must be redacted.
