# License Package

Licenses are signed with an Ed25519 private key held only by the BaiRui
platform. Customer deployments receive the license document and public key,
never the signing key.

Payloads contain license and organization identity, plan, features, limits,
issue time, and expiry. They must not contain API keys, connector tokens,
prompts, chat history, files, or customer business data.

```sh
BAIRUI_LICENSE_PRIVATE_KEY="<protected PEM>" npm run license:generate -- \
  --license-id=lic_dev \
  --organization-id=org_dev \
  --plan=starter \
  --expires-at=2030-01-01T00:00:00.000Z \
  --out=./tmp/licenses/lic_dev.json
```

Private keys belong in a secret manager or protected environment variable and
must never be committed to this repository or copied into a delivery bundle.
