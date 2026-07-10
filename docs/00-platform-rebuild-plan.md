# BaiRui Cloud Agent Platform Plan

This document defines the platform-side plan for
`BaiRui-cloud-agent-platform`.

The platform repository is not the agent runtime repository. Runtime framework
decisions live in `LUTAO581314/BaiRui-agent`.

## 1. Current Position

`BaiRui-cloud-agent-platform` owns the cloud platform around customer
deployments:

- website;
- customer console;
- admin console;
- organization and account management;
- license workflow;
- deployment wizard;
- server registry;
- server-agent heartbeat;
- acceptance evidence;
- support workflow;
- release and readiness views.

It does not own Hermes runtime internals, agent loop, model calls, tool calls,
memory runtime, skills, OpenClaw internals, BaiLongma internals, customer
prompts, chat history, files, model API keys, or connector tokens.

## 2. Alignment With The BaiRui Agent Framework

| Framework area | Platform responsibility |
| --- | --- |
| Core Runtime Layer | deliver license, deployment config, release metadata, and platform identity |
| Service Integration Layer | display readiness and capability summaries |
| Data Storage Layer | track backup/readiness evidence, not customer data bodies |
| Channel Bridge Layer | display connector health and delivery summaries |
| UI Exposure Layer | host platform console; do not own Brain UI internals |
| Bairui Control Plane | ingest health, readiness, version, release gate, and acceptance evidence |

## 3. P0 Scope

P0 should include:

- platform health and readiness endpoints;
- organization and license records;
- license generation;
- customer server registration;
- server heartbeat ingestion;
- acceptance report ingestion;
- deployment bundle generation;
- admin view of server readiness;
- support-safe diagnostic metadata.

## 4. Recommended Technical Direction

Recommended stack:

- Next.js;
- TypeScript;
- PostgreSQL;
- Prisma or Drizzle;
- Tailwind CSS;
- shadcn/ui;
- Auth.js or equivalent auth/session layer;
- Docker Compose;
- GitHub Actions;
- Playwright.

The current Node standard-library P0 API can remain as a simple runnable
baseline until the web platform is scaffolded.

## 5. License Flow

1. Customer selects a plan.
2. Platform creates organization and license records.
3. Platform generates a signed license.
4. Deployment wizard creates a customer delivery bundle.
5. Customer server installs Hermes Runtime Core, Bairui Runtime Boundary, and
   server-agent configuration.
6. Server-agent reports heartbeat and acceptance evidence.
7. Platform shows readiness, license status, and release status.

The license must not include customer secrets, model API keys, connector
tokens, prompts, chat history, files, or Obsidian note bodies.
