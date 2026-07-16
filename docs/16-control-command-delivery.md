# Control Command Delivery

## Machine identities

Servers and Agent Runtimes use separate machine credentials. The platform
returns each token once and stores only its SHA-256-derived HMAC key and a short
display hint. Requests bind the HTTP method, path, timestamp, nonce, and body;
accepted nonces are persisted to prevent replay across platform replicas.

The legacy global ingest token remains temporarily available for old snapshot
senders. Command leasing always requires a Server Credential, and new Runtime
heartbeats use an Agent Runtime Credential.

## Lease and receipt lifecycle

```text
queued -> leased -> accepted -> running -> succeeded
                                     \-> failed/cancelled
```

PostgreSQL leases commands with `FOR UPDATE SKIP LOCKED`. Expired leases return
to the queue while expired commands do not. Receipts are idempotent by command,
attempt, and state. A successful provision receipt records a private Runtime
route and moves the Runtime to `starting`; only a later healthy Agent heartbeat
moves it to `ready`.

## Secret delivery

Provider, Hermes API, Runtime Boundary, and Agent control credentials are
encrypted inside an Agent-scoped configuration revision. They are decrypted
only for an authenticated Server lease response over TLS. They are never
returned to `/app`, `/admin`, logs, telemetry, command arguments, or receipts.

## Supervisor

The host Supervisor executes a fixed action map through `execFile` and Docker
argument arrays. Remote commands cannot supply executable names, shell text,
container images, host paths, or Docker flags. Images, port ranges, instance
root, platform URL, and advertised host come from the local service
configuration.

Deleting an Agent removes its known containers and network but retains its data
directory for the separate backup and retention workflow.

`backup.restore` is leased only after approval and only for a verified backup
owned by the target deployment. The Supervisor resolves the encrypted file from
its fixed backup root, rejects unsafe archive paths and links, retains a local
rollback copy, and reports restore evidence without returning backup content.

`backup.expire` is generated only by the platform retention scheduler. It
contains a backup identifier, is idempotent when the local file is already
absent, validates Agent ownership when the encrypted file exists, and never
accepts a path from an administrator or remote command.
