# BaiRui Server Management Plan

This document defines safe customer-server management for BaiRui deployments.

## 1. Goal

The platform should know whether a customer deployment is alive, licensed,
ready, and supportable. It should not become an unrestricted remote-control
system.

## 2. Server-Agent Model

The customer server-agent runs inside the customer environment and reports
outbound to the platform.

Responsibilities:

- register server identity;
- report heartbeat;
- report runtime health;
- report readiness summary;
- report backup status;
- submit acceptance evidence;
- collect diagnostic bundles only after customer action;
- execute only white-listed maintenance actions.

Forbidden:

- arbitrary shell command execution;
- unauthenticated public control ports;
- storing root passwords in the platform;
- uploading prompts, chat history, files, Obsidian note bodies, model keys, or
  connector tokens by default.

## 3. Required Endpoints

Platform receives:

- `POST /api/internal/control-plane/snapshots`
- `POST /api/server-acceptance`
- `GET /api/servers`
- `GET /api/server-acceptance`

Customer server exposes locally or privately:

- Hermes `/platform/heartbeat`
- runtime `/health`
- runtime `/ready`
- runtime `/version`
- runtime `/capabilities`

## 4. Control Plane Alignment

The platform should forward or expose server state to the Bairui Control Plane:

- server inventory;
- license status;
- runtime version;
- readiness status;
- acceptance status;
- release gate status;
- support blockers.
