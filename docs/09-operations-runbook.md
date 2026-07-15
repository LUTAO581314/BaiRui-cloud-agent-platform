# Operations Runbook

## Backup

```sh
DATABASE_URL="<protected connection>" npm run operations:backup -- ./backups/bairui.dump
```

Encrypt backups at rest, copy them to a separate failure domain, and test a
restore regularly. The backup contains customer records and audit evidence.

## Restore

Restore is destructive and requires explicit confirmation:

```sh
DATABASE_URL="<protected connection>" BAIRUI_CONFIRM_RESTORE=RESTORE \
  npm run operations:restore -- ./backups/bairui.dump
```

Stop incoming writes, record the incident, restore, run migrations, and execute
the server acceptance check before reopening traffic.

## Rollback

Every production image must use an immutable version or commit tag:

```sh
npm run operations:rollback -- ghcr.io/owner/bairui-platform:<previous-commit>
```

Database migrations must remain backward-compatible for at least one release.
Otherwise restore the matching pre-release backup as a separate operation.
