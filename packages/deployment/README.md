# Deployment Package

This package creates customer delivery bundles with explicit deployment
identity, an optional signed license, and a SHA-256 manifest.

```sh
npm run delivery:write -- \
  --organization-id=org_demo \
  --license-id=lic_demo \
  --server-id=srv_demo \
  --platform-url=https://platform.example.com \
  --license=./tmp/licenses/lic_demo.json \
  --out=./tmp/delivery/org_demo-srv_demo

npm run delivery:verify -- --in=./tmp/delivery/org_demo-srv_demo
npm run delivery:archive -- --in=./tmp/delivery/org_demo-srv_demo
```

The full signed release flow requires the platform-only Ed25519 private key:

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

No model key, connector token, runtime shared secret, session secret, or
license private key is written into a bundle.
