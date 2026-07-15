# Server Protocol Package

This package defines the protocol between the BaiRui Cloud Agent Platform,
customer servers, customer server-agent, the Bairui Runtime Boundary, and
Hermes Runtime Core.

Protocol domains:

- server registration;
- heartbeat;
- health summary;
- readiness summary;
- backup status;
- release check;
- acceptance report;
- diagnostic bundle upload;
- white-listed server actions.

Operational control and Hermes runtime execution are separate protocols. This
package must not define prompt, conversation, Agent task, model/tool, skill,
runtime-memory, or arbitrary shell actions. A control credential cannot call
the Runtime API.

The protocol must default to outbound connections from the customer server to
the platform. It must not expose an unauthenticated public control port.

## Current Compatibility Heartbeat

`packages/server-protocol/index.mjs` defines the first handoff contract between
the BaiRui platform and customer servers.

Required fields:

- `protocol_version`
- `server_id`
- `organization_id`
- `license_id`
- `license_status`
- `hermes_version`
- `health_status`
- `database_status`
- `backup_status`
- `connector_status_summary`
- `error_count_24h`
- `brand_key`
- `created_at`

The heartbeat is operational metadata only. It must not contain user prompts,
conversation records, files, Obsidian note bodies, memory content, model API
keys, connector tokens, passwords, private keys, or unrestricted logs.

## Control Protocol 1.0

`control-plane.mjs` validates the complete allow-list and action-specific
identifier arguments for deployment operations. It rejects extra payload
fields and all Hermes data-plane actions before a command can be queued or
leased. See `docs/11-control-plane-protocol.md`.

