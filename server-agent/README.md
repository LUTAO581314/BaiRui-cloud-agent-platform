# BaiRui Server Agent

The server agent is the customer-server management component for BaiRui
deployments.

It runs inside customer VPS, VM, or managed environments and reports safe
operational summaries back to the BaiRui Cloud Agent Platform.

Responsibilities:

- register the server;
- report heartbeat;
- report resource summaries;
- report Hermes Runtime Core health;
- report Bairui Runtime Boundary readiness where available;
- report backup status;
- create, verify, and approval-gate restore of encrypted Agent backups;
- expire encrypted Agent backups through policy-generated identifier commands;
- collect diagnostic bundles after customer action;
- execute white-listed maintenance actions.

It manages the deployment around Hermes. It does not manage an Agent run inside
Hermes and must never accept prompts, Agent tasks, model/tool calls, skills, or
runtime-memory operations as control actions.

Forbidden:

- arbitrary shell command execution;
- storing root passwords in the platform;
- uploading customer chat content;
- uploading Obsidian vault content;
- uploading model API keys;
- uploading connector tokens;
- exposing an unauthenticated public control port.

Formal customer deployments should use VPS or VM isolation with Docker Compose
inside the customer environment.

## Current Observation Cycle

The currently implemented one-shot observation cycle lives in
`server-agent/index.mjs`.

It performs one safe outbound reporting cycle:

```text
Hermes GET /platform/heartbeat
  -> validate heartbeat with packages/server-protocol
  -> POST heartbeat to BaiRui platform
```

Environment variables:

- `BAIRUI_HERMES_HEARTBEAT_URL`: defaults to
  `http://127.0.0.1:8787/platform/heartbeat`.
- `BAIRUI_PLATFORM_HEARTBEAT_URL`: required platform receive endpoint.
- `BAIRUI_SERVER_AGENT_TOKEN`: optional bearer token issued by the platform.
- `BAIRUI_SERVER_AGENT_TIMEOUT_MS`: request timeout, default `10000`.

Run one report cycle:

```sh
npm run server-agent:once
```

Run the assisted deployment acceptance check:

```sh
npm run server-agent:acceptance
```

The acceptance command checks Hermes heartbeat, posts the heartbeat to the
platform, then confirms `GET /api/servers` contains the same server id. It
prints a JSON report and exits non-zero when any check fails.

The agent reports only operational metadata already exposed by runtime
heartbeat. It does not upload prompts, chat history, files, Obsidian note
bodies, memory content, passwords, private keys, or model and connector
secrets.

The long-running outbound daemon in `server-agent/daemon.mjs` leases commands
with a Server Credential, validates the strict control protocol, and delegates
only to the fixed action map in `server-agent/supervisor.mjs`. The Supervisor
uses Docker argument arrays without a shell. The one-shot observation command
remains available for diagnostics.

The same daemon collects infrastructure telemetry every
`BAIRUI_RESOURCE_INTERVAL_MS` (default `30000`). The collector enumerates only
containers named in verified `instance.json` files, then calls fixed `docker
info`, `docker container ls`, `docker container inspect --size`, and `docker
stats --no-stream` argument arrays. It reports CPU, memory, fixed Agent
workspace size, host filesystem utilization, OS/architecture, container role,
image/version metadata, and start time through the signed server identity.
It never accepts a path or Docker argument from the platform.

When `BAIRUI_USER_ID`, `BAIRUI_AGENT_ID`, and `BAIRUI_RUNTIME_ID` are set, the
observation cycle also submits Agent-scoped five-layer telemetry. This payload
contains health, versions, numeric metrics, and usage aggregates only. It does
not contain conversation or memory content.

Resource telemetry also excludes prompts, conversation content, Obsidian note
bodies, environment values, API keys, connector tokens, browser fingerprints,
and end-user device contents.

