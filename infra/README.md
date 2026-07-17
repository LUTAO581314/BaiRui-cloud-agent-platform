# Infrastructure

Infrastructure templates for BaiRui Cloud Agent Platform and managed deployments.

Planned contents:

- Docker Compose templates;
- Nginx templates;
- deployment scripts;
- server hardening scripts;
- backup templates;
- monitoring templates.

Do not commit real server IPs, credentials, private keys, TLS certificates,
database passwords, or customer-specific environment files.

## Deployment ownership

Source-level development templates remain in `infra/`. The installable product
release is owned by `distribution/` and the `BaiRui Product Distribution`
GitHub workflow.

Production rules:

- consume only a GitHub Release with `release-manifest.json` and `SHA256SUMS`;
- use every container as `image@sha256:digest`;
- keep generated secrets under `/etc/bairui-agent` with mode `0600`;
- keep PostgreSQL and Agent data outside the source checkout;
- run the authenticated Server Agent, not an unauthenticated control port;
- retain the previous release files before an upgrade.

The exact-version installer command is:

```sh
curl -fsSL https://github.com/LUTAO581314/BaiRui-cloud-agent-platform/releases/download/v0.1.0-rc.1/install.sh | sudo bash -s -- --domain agent.example.com
```
