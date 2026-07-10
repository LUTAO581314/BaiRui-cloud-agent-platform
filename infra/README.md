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

## Platform P0 Deployment

P0 deployment assets live under `infra/platform`.

Files:

- `env.example`: placeholder environment file.
- `systemd/bairui-platform.service`: Linux service template.
- `scripts/deploy-platform.sh`: install dependencies, optionally run database
  migrations, run tests, and prepare the service template.

Default safe run from repository root:

```sh
sh infra/platform/scripts/deploy-platform.sh
```

Production run on a prepared Linux server:

```sh
sudo install -d -m 0750 /etc/bairui
sudo cp infra/platform/env.example /etc/bairui/platform.env
sudo editor /etc/bairui/platform.env
BAIRUI_INSTALL_SYSTEMD=1 sudo -E sh infra/platform/scripts/deploy-platform.sh
```

The script does not commit or generate real secrets. Keep production values in
`/etc/bairui/platform.env` or an equivalent protected server-side secret store.
