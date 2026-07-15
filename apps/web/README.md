# BaiRui Web Platform

This directory contains the runnable user workspace and administrator console.

## Surface Boundaries

- `/app` and `/api/user/*`: authenticated user product surface.
- `/admin` and `/api/admin/*`: organization or platform administrator surface.
- `/api/internal/*`: machine-authenticated control-plane ingestion.

User and administrator JavaScript are separate. The administrator asset is
served only after a server-side role check. API authorization remains the
security boundary even when a route or asset is hidden.

## Runtime Connection

User messages are converted into a platform-owned `RuntimeRequest` by
`packages/server-protocol/runtime-client.mjs`. Organization and user identity
come from the server session, not from browser input. Requests to the customer
Runtime Boundary use a timestamp, nonce, HMAC signature, and replay rejection.

## Storage

Production requires PostgreSQL through `DATABASE_URL`. Memory storage is
allowed only for development and automated tests. Run migrations before the
web process:

```sh
npm run db:migrate
npm run platform:dev
```

Required production variables are documented in
`docs/08-security-and-access-control.md` and `infra/.env.example`.
