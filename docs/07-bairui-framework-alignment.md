# Bairui Framework Alignment

This repository follows the framework source of truth in
`LUTAO581314/BaiRui-agent`.

## 1. Placement

`BaiRui-cloud-agent-platform` is not the agent runtime repository.

It is the platform repository for:

- customer onboarding;
- license and subscription workflow;
- deployment wizard;
- customer server registry;
- server-agent heartbeat and acceptance;
- support workflow;
- release and readiness views;
- Bairui Control Plane platform integration.

## 2. Relationship To The Five-Layer Agent Framework

| Agent framework area | Owned by | Platform role |
| --- | --- | --- |
| Core Runtime Layer | `BaiRui-agent` using `NousResearch/hermes-agent` | provide license, deployment config, release metadata, and platform identity |
| Service Integration Layer | `BaiRui-agent` adapters | show readiness and capability status, not service internals |
| Data Storage Layer | customer deployment and runtime | define backup, readiness, and acceptance evidence |
| Channel Bridge Layer | `BaiRui-agent`, OpenClaw/BaiLongma references | show connector readiness and delivery summaries |
| UI Exposure Layer | `BaiRui-agent`, BaiLongma reference | host platform console; do not own Brain UI internals |
| Bairui Control Plane | cross-cutting governance | ingest health, version, readiness, test evidence, and release gate state |

## 3. Platform Boundary

The platform should know:

- which customer owns a deployment;
- which license is active;
- which server is registered;
- which version is running;
- whether readiness checks pass;
- whether release gates pass;
- whether support evidence exists.

The platform should not know by default:

- customer prompts;
- chat history;
- Obsidian note bodies;
- customer files;
- model API keys;
- connector tokens;
- unrestricted server logs.

## 4. Integration Points

Platform to customer server:

- license file;
- deployment bundle;
- environment template;
- server-agent config;
- release metadata;
- documentation links.

Customer server to platform:

- heartbeat;
- readiness summary;
- acceptance report;
- diagnostic bundle metadata;
- release version;
- support ticket attachments after customer action.

Platform to Bairui Control Plane:

- platform deployment health;
- customer server inventory;
- license status;
- release gate status;
- acceptance evidence;
- support blockers.

## 5. Naming Rule

Use `BaiRui` or `bairui` for this repository.

Avoid old platform names in new documentation, APIs, package names, or UI text.

