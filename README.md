# MOXI Cloud Agent

MOXI Cloud Agent is the commercial website, customer platform, and server
management control plane for the bairui Agent OS product line.

This repository is not the Hermes runtime. Hermes remains the customer-side
Agent OS product kernel. This repository sells, delivers, licenses, monitors,
and supports Hermes deployments.

## Current Decision

The repository is being rebuilt from source according to the current commercial
plan. Historical prototype code has been removed from the active tree.
Future code must follow the boundaries in this README and `docs/`.

Default customer-facing brand fields:

- brand key: `bairui`;
- trademark name: `bairui`;
- logo text: `bairui`.

The old prototype taught useful lessons:

- user registration and login;
- plan and subscription models;
- quotas;
- device/server pairing;
- WebSocket heartbeat;
- audit events;
- local agent prototype ideas;
- Docker Compose development pattern.

Those ideas may be reimplemented in the new codebase, but the old product
boundary is no longer active.

## Product Role

`MOXI-cloud-agent` owns:

- official website;
- product pages;
- customer console;
- admin console;
- plans and subscriptions;
- license generation;
- deployment wizard;
- server registration;
- server heartbeat summaries;
- version and release management;
- support tickets;
- diagnostic bundle uploads;
- managed deployment operations.

`MOXI-cloud-agent` does not own:

- Hermes runtime internals;
- customer business chat content;
- customer Obsidian vault content;
- third-party model API keys;
- customer connector tokens;
- direct unrestricted shell control of servers.

## Three-Pillar Architecture

```text
Customer / Sales
  -> MOXI Website
  -> Customer Console
  -> License / Deployment Wizard
  -> VPS or VM
  -> Docker Compose
  -> Hermes Agent OS
  -> Health Summary Back To Platform
  -> Support / Renewal / Upgrade
```

## Repository Direction

Target structure:

```text
MOXI-cloud-agent/
  apps/
    web/                 # website, customer console, admin console
  packages/
    db/                  # platform database schema
    deployment/          # customer deployment bundle generation
    license/             # license generation and verification helpers
    server-protocol/     # server heartbeat and deployment protocol
    ui/                  # shared UI components
  server-agent/
    installer/
    agent/
    systemd/
  infra/
    docker/
    nginx/
    scripts/
  docs/
    00-platform-rebuild-plan.md
    01-server-management-plan.md
    02-license-and-deployment-flow.md
    03-hermes-platform-contract.md
```

## Recommended Technical Direction

Commercial platform:

- Next.js;
- TypeScript;
- PostgreSQL;
- Prisma or Drizzle;
- Tailwind CSS;
- shadcn/ui;
- Auth.js or equivalent auth layer;
- Docker Compose;
- GitHub Actions;
- Playwright.

Server management:

- VPS or VM per formal customer;
- Docker Compose inside each customer VM;
- outbound server heartbeat;
- no public unauthenticated control port;
- white-listed server actions only;
- diagnostic bundle upload only after customer action;
- no customer business data uploaded by default.

## Documentation

- [Commercial Platform Rebuild Plan](docs/00-platform-rebuild-plan.md)
- [Server Management Plan](docs/01-server-management-plan.md)
- [License And Deployment Flow](docs/02-license-and-deployment-flow.md)
- [Hermes Platform Contract](docs/03-hermes-platform-contract.md)
- [Repository Cleanup Policy](docs/04-repository-cleanup-policy.md)

## P0 Platform Deployment

Run the local deployment check:

```sh
sh infra/platform/scripts/deploy-platform.sh
```

For production, copy `infra/platform/env.example` to a protected server path
such as `/etc/bairui/platform.env`, set real values, then run the script with
`BAIRUI_INSTALL_SYSTEMD=1` as root to install the systemd service.
When `BAIRUI_PLATFORM_DATABASE_URL` is set, the script runs `npm run db:migrate`
by default. Keep `BAIRUI_RUN_MIGRATIONS=1` for server rebuilds so PostgreSQL
tables such as `server_acceptance_reports` are created before the API starts.
After startup, check `GET /ready` before customer deployment or acceptance.

Generate a customer Hermes deployment bundle:

```sh
npm run deployment:bundle:print -- --organization-id=org_demo --license-id=lic_demo --server-id=srv_demo --platform-url=https://platform.example.com
```

Write a customer delivery package:

```sh
BAIRUI_LICENSE_SECRET=change-me npm run delivery:write -- --organization-id=org_demo --license-id=lic_demo --server-id=srv_demo --platform-url=https://platform.example.com --out=./tmp/delivery/org_demo-srv_demo
```

Verify a customer delivery package:

```sh
BAIRUI_LICENSE_SECRET=change-me npm run delivery:verify -- --in=./tmp/delivery/org_demo-srv_demo
```

Archive a customer delivery package:

```sh
npm run delivery:archive -- --in=./tmp/delivery/org_demo-srv_demo --out=./tmp/delivery/org_demo-srv_demo.tar.gz
```

Run the full release flow:

```sh
BAIRUI_LICENSE_SECRET=change-me npm run delivery:release -- --organization-id=org_demo --license-id=lic_demo --server-id=srv_demo --platform-url=https://platform.example.com --out=./tmp/delivery/org_demo-srv_demo
```

Run customer-server acceptance after Hermes and server-agent environment files
are installed:

```sh
npm run server-agent:acceptance
```

## Immediate Next Steps

1. Create the new platform skeleton under `apps/web`.
2. Build license, customer organization, server registration, and deployment
   wizard first.
3. Keep Hermes as a separate deployable product.
4. Add server heartbeat contract between Hermes/customer VM and platform.
5. Implement the server agent from the white-listed action model.
6. Prepare the first customer trial flow before adding full online payment.
