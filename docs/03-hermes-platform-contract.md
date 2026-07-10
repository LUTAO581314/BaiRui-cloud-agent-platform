# Bairui Platform Contract

This document defines the contract between the BaiRui Cloud Agent Platform, the
Bairui Control Plane, the Bairui Runtime Boundary, the customer server-agent,
and Hermes Runtime Core.

Hermes remains the agent runtime core. The platform does not own the Hermes
runtime internals.

## 1. Ownership

Hermes Runtime Core owns:

- agent loop;
- model calls;
- tool calls;
- memory runtime;
- skills and scheduled work;
- runtime audit and runtime diagnostics;
- runtime-level health and capability reporting.

Bairui Runtime Boundary owns:

- platform identity mapping;
- tenant, organization, workspace, and license context;
- platform request and response envelopes;
- runtime configuration mapping;
- contract tests that protect Bairui from Hermes upstream changes.

Bairui Cloud Agent Platform owns:

- website;
- customer console;
- admin console;
- organization and account management;
- license generation and delivery;
- deployment wizard and delivery bundles;
- customer server registry;
- release inventory;
- support workflow;
- server-agent protocol and acceptance evidence.

Bairui Control Plane owns:

- health and readiness inventory;
- dependency drift tracking;
- upstream version and commit inventory;
- contract-test and smoke-test evidence;
- release gates;
- platform heartbeat summaries.

## 2. Platform To Runtime Boundary

The platform may provide:

- organization id;
- workspace id;
- license id and license status;
- deployment mode;
- enabled feature set;
- release metadata;
- deployment template;
- support upload endpoint;
- documentation links.

The platform must not provide raw model API keys or connector tokens through
customer-visible contracts. Secret delivery must use a protected server-side
workflow.

## 3. Runtime And Server-Agent To Platform

Runtime and customer server-agent may report:

- server id;
- organization id;
- license id;
- license status;
- Hermes version;
- Bairui Runtime Boundary version;
- deployment mode;
- health status;
- readiness status;
- database status;
- backup status;
- connector summary;
- enabled capability summary;
- error count;
- last seen time;
- acceptance report summary.

## 4. P0 Heartbeat Contract

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

The platform validates this payload before storing server state. The customer
server sends it outbound to the platform; the platform must not require an
unauthenticated inbound control port on the customer server.

## 5. P0 Acceptance Report Contract

After assisted deployment, `server-agent:acceptance` sends a JSON report to:

```text
POST /api/server-acceptance
```

The report contains:

- server identity;
- organization identity;
- license identity;
- generated timestamp;
- overall accepted status;
- check summaries.

It must not contain prompts, chat history, files, Obsidian note bodies, model
keys, connector tokens, passwords, private keys, or unrestricted logs.

The platform stores acceptance summaries for customer delivery evidence and
support audit. Operators can query:

```text
GET /api/server-acceptance?server_id=srv_xxx
```

## 6. Default Data Boundary

The runtime and server-agent must not upload by default:

- chat content;
- Obsidian vault content;
- customer files;
- model API keys;
- connector tokens;
- database dumps;
- private logs with secrets.

Diagnostic bundles must be customer-triggered and redacted.

