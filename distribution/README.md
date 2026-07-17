# BaiRui Distribution

This directory owns the installable BaiRui product release. A release binds one
Platform commit, one Agent commit, the pinned Hermes and BaiLongma upstreams,
the contracts version, the PostgreSQL migration and every container image by
digest.

The source repositories and package versions are not deployment selectors.
Only a verified `release-manifest.json` attached to a GitHub Release may be
installed or rolled back.

Install an exact release on a clean Ubuntu or Debian host:

```sh
curl -fsSL https://github.com/LUTAO581314/BaiRui-cloud-agent-platform/releases/download/v0.1.0-rc.7/install.sh | sudo bash -s -- --domain agent.example.com
```

The installer:

- installs Docker Engine and the Compose plugin when absent;
- verifies the release bundle SHA-256 and immutable image references;
- generates protected database, session, machine and license keys;
- starts PostgreSQL, Platform, Channel Worker and Caddy;
- registers the local Server Agent through the authenticated Platform API;
- starts the Server Agent with the exact Runtime and Hermes digests;
- preserves the prior release for rollback if an upgrade health gate fails.

Production installation requires public release images or an existing
authenticated `docker login ghcr.io` session with pull access. No GitHub token
is written by the installer.
