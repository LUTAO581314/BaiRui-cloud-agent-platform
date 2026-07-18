# BaiRui Distribution

This directory owns the installable BaiRui product release. A release binds one
Platform commit, one Agent commit, the pinned Hermes and BaiLongma upstreams,
the contracts version, the PostgreSQL migration and every container image by
digest.

The source repositories and package versions are not deployment selectors.
Only a verified `release-manifest.json` attached to a GitHub Release may be
installed or rolled back.

## Direct TLS mode

Install an exact release on a clean Ubuntu or Debian host:

```sh
curl -fsSL https://github.com/LUTAO581314/BaiRui-cloud-agent-platform/releases/download/v0.1.0-rc.8/install.sh | sudo bash -s -- --domain agent.example.com
```

This remains the default mode. Caddy owns TCP ports 80 and 443 plus UDP port
443, obtains the public certificate and routes both the Platform and
`/callbacks/wechat/` traffic.

## Existing Nginx mode

When Nginx already owns ports 80 and 443, bind the release Caddy to a
non-privileged loopback port instead:

```sh
curl -fsSL https://github.com/LUTAO581314/BaiRui-cloud-agent-platform/releases/download/v0.1.0-rc.8/install.sh | sudo bash -s -- \
  --domain agent.example.com \
  --external-proxy-bind 127.0.0.1:18080
```

The installer applies the release-owned `compose.external-proxy.yaml`. It
replaces, rather than appends to, the direct Caddy port list and makes Caddy
serve plain HTTP on container port 8080. The only host publication is
`127.0.0.1:18080:8080`; ports 80 and 443 remain available to Nginx. Proxy the
entire origin to that listener so Caddy continues to route the Platform and
the WeChat callback:

```nginx
location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The bind accepts only IPv4 loopback addresses in `127.0.0.0/8` or canonical
IPv6 loopback such as `[::1]:18080`, with a port from 1024 through 65535.
`0.0.0.0`, public or private interface addresses, hostnames and privileged
ports are rejected. Configure and reload the public Nginx HTTPS virtual host
before installation because the health gate and Server Agent registration use
the public `https://<domain>` origin.

An upgrade without `--external-proxy-bind` preserves an existing external
proxy mode and its bind. Passing the option again changes the saved bind. The
previous mode, environment and fixed Compose override are stored with the
prior release and restored together if the upgrade health gate rolls back.

The installer:

- installs Docker Engine and the Compose plugin when absent;
- verifies the release bundle SHA-256 and immutable image references;
- validates both the direct and external-proxy Compose configurations;
- generates protected database, session, machine and license keys;
- starts PostgreSQL, Platform, Channel Worker and Caddy;
- registers the local Server Agent through the authenticated Platform API;
- starts the Server Agent with the exact Runtime and Hermes digests;
- preserves the prior release for rollback if an upgrade health gate fails.

Production installation requires public release images or an existing
authenticated `docker login ghcr.io` session with pull access. No GitHub token
is written by the installer.
