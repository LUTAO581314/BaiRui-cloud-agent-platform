# Deployment Package

This package builds customer deployment bundles for BaiRui customer servers.

It generates:

- Hermes Runtime Core environment file content;
- Bairui Runtime Boundary and platform context configuration where needed;
- server-agent outbound heartbeat environment file content;
- customer/operator deployment instructions;
- signed license JSON when `delivery.mjs` is used;
- `manifest.json` with file hashes and delivery identity metadata.

The package does not generate or store real secrets. Production secrets must be
created by the platform secret service or operator workflow and injected as
server-side values.

Write a customer delivery package:

```sh
BAIRUI_LICENSE_SECRET=change-me npm run delivery:write -- \
  --organization-id=org_demo \
  --license-id=lic_demo \
  --server-id=srv_demo \
  --platform-url=https://platform.example.com \
  --out=./tmp/delivery/org_demo-srv_demo
```

Verify a customer delivery package before sending it:

```sh
BAIRUI_LICENSE_SECRET=change-me npm run delivery:verify -- \
  --in=./tmp/delivery/org_demo-srv_demo
```

Archive a verified package:

```sh
npm run delivery:archive -- \
  --in=./tmp/delivery/org_demo-srv_demo \
  --out=./tmp/delivery/org_demo-srv_demo.tar.gz
```

The command returns the archive `sha256` for customer acceptance and support
records.

Run the full release flow in one command:

```sh
BAIRUI_LICENSE_SECRET=change-me npm run delivery:release -- \
  --organization-id=org_demo \
  --license-id=lic_demo \
  --server-id=srv_demo \
  --platform-url=https://platform.example.com \
  --out=./tmp/delivery/org_demo-srv_demo
```

This writes the package directory, verifies it, creates the `.tar.gz`, and
prints the archive `sha256`.

