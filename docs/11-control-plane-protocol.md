# Bairui Control Plane Protocol

Protocol version `1.0` is operational control traffic only.

Allowed actions:

- `snapshot.collect`
- `probe.run`
- `contract.test`
- `smoke.test`
- `upstream.check`
- `config.stage`
- `config.apply`
- `backup.create`
- `backup.verify`
- `backup.restore`
- `release.stage`
- `release.apply`
- `release.rollback`
- `service.restart`

There is no generic command and no prompt, conversation, task, model, tool,
skill, runtime-memory, or Runtime API action. `packages/server-protocol/control-plane.mjs`
enforces the allow-list and action-specific identifier arguments.

## State machine

```text
queued -> leased -> accepted -> running -> succeeded
                                      \-> failed
queued/leased/accepted/running -> cancelled or expired
```

Each lease has an expiry and attempt number. Each event has a monotonic sequence.
The platform deduplicates command id, idempotency key, attempt, and event
sequence. A command that expired before execution is never started.

## Separation

| Protocol | Data | Credential |
| --- | --- | --- |
| Control | deployment state, references, observations, evidence | deployment identity |
| Runtime | `RuntimeRequest`, result, runtime event | Runtime shared secret |
| Channel | inbound/outbound message, delivery receipt | connector identity |

A credential from one protocol cannot authenticate to another. Control command
arguments contain revision/release/backup/probe/service identifiers, never raw
secret values, user content, or executable text.

## Closed-loop result

A command is not successful merely because an API accepted it. Success requires
server-agent execution plus a matching post-action observation. Configuration
and release records stay `pending` or `applying` until verification succeeds;
failure records the evidence and either rolls back or blocks further rollout.
