# License And Deployment Flow

This document defines the commercial license and deployment flow between
BaiRui-cloud-agent-platform and Hermes.

## 1. Flow

```text
Customer signs up
  -> chooses plan
  -> platform creates organization
  -> platform creates license
  -> customer creates server record
  -> platform generates deployment instructions
  -> customer deploys Hermes on VPS / VM
  -> Hermes validates license locally
  -> Hermes reports health summary
  -> platform shows server status
```

## 2. License Fields

Required fields:

- license_id;
- organization_id;
- plan_code;
- features;
- limits;
- issued_at;
- expires_at;
- deployment_mode;
- signature.

Optional fields:

- customer_name;
- allowed_server_count;
- release_channel;
- support_level.

Forbidden fields:

- API keys;
- connector tokens;
- passwords;
- private keys;
- chat content;
- Obsidian note content.

## 3. Deployment Modes

Supported commercial modes:

- local production;
- customer VPS;
- customer VM;
- managed VM;
- enterprise dedicated server.

The default paid deployment path is:

```text
VPS / VM -> Docker Compose -> Hermes -> health summary -> platform
```

## 4. First Version

The first commercial version can be semi-manual:

- platform generates license;
- platform generates deployment command;
- customer or BaiRui operator runs deployment;
- server is registered manually;
- health is checked automatically.

Full automatic provisioning should come after the first real customer trials.

## 5. Platform Deployment Command

The platform repository provides a production Docker Compose deployment:

```sh
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --build
```

The platform container waits for PostgreSQL, applies migrations, and then starts
the web process. Nginx terminates HTTPS using `infra/nginx/bairui.conf`.

## 6. Customer Hermes Deployment Bundle

The platform can generate the current customer deployment bundle:

```sh
npm run deployment:bundle:print -- \
  --organization-id=org_demo \
  --license-id=lic_demo \
  --server-id=srv_demo \
  --platform-url=https://platform.example.com
```

The bundle includes Hermes environment values, server-agent outbound heartbeat
values, and operator/customer instructions. It must not include production
model keys, connector tokens, SSH keys, or customer business data.

To write a full delivery package with signed license JSON:

```sh
npm run delivery:write -- \
  --organization-id=org_demo \
  --license-id=lic_demo \
  --server-id=srv_demo \
  --platform-url=https://platform.example.com \
  --license=./tmp/licenses/lic_demo.json \
  --out=./tmp/delivery/org_demo-srv_demo
```

The package includes `manifest.json` with file hashes, organization id,
license id, server id, platform URL, generation time, and manifest version.

Verify before sending:

```sh
npm run delivery:verify -- \
  --in=./tmp/delivery/org_demo-srv_demo
```

Archive after verification:

```sh
npm run delivery:archive -- \
  --in=./tmp/delivery/org_demo-srv_demo \
  --out=./tmp/delivery/org_demo-srv_demo.tar.gz
```

Record the returned archive `sha256` in the customer acceptance and support
records.

For the complete release flow:

```sh
BAIRUI_LICENSE_PRIVATE_KEY="<protected PEM>" npm run delivery:release -- \
  --organization-id=org_demo \
  --license-id=lic_demo \
  --server-id=srv_demo \
  --platform-url=https://platform.example.com \
  --plan=business \
  --expires-at=2030-01-01T00:00:00.000Z \
  --out=./tmp/delivery/org_demo-srv_demo
```

After the customer server is configured and Hermes is running, execute the
acceptance check on the customer server:

```sh
npm run server-agent:acceptance
```

Save the JSON report with the archive `sha256` in the customer acceptance and
support records.
