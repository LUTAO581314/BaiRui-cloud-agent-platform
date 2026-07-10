# Repository Cleanup Policy

This repository is the BaiRui platform repository. Keep it aligned with the
framework source of truth in `LUTAO581314/BaiRui-agent`.

## Keep

- platform API and web app code;
- database schema and migrations;
- license package;
- deployment bundle package;
- server-protocol package;
- server-agent package;
- infrastructure scripts;
- documentation about platform delivery, server management, and control-plane
  integration.

## Do Not Add

- Hermes runtime internals;
- duplicated agent loop logic;
- OpenClaw channel implementation internals;
- BaiLongma Brain UI implementation internals;
- customer chat content fixtures;
- real model API keys;
- real connector tokens;
- unrestricted remote shell workflows.

## Naming

Use:

- `BaiRui Cloud Agent Platform`
- `BaiRui`
- `bairui`
- `Bairui Control Plane`
- `Hermes Runtime Core`
- `Bairui Runtime Boundary`

Avoid old or unrelated platform names in new files.
