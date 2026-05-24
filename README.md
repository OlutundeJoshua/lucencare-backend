# LucenCare Backend

A consent-first health data platform connecting patients, NGOs, HMOs, and clinical researchers. Patients explicitly control what health data is shared, with whom, and for what purpose. No organisation ever accesses live patient records — they read only from point-in-time snapshots captured at enrollment time.

## Prerequisites

- Node.js 22 LTS
- pnpm 9+
- PostgreSQL 17 (with RLS policies applied via migrations)
- Redis 7.x
- An RS256 key pair (for JWT signing)
- S3-compatible object storage (for PDF exports)

## Install & Run

```bash
# Clone and install
pnpm install

# Configure environment
cp .env.example .env
# Edit .env — fill in DB, Redis, JWT keys, S3 values

# Run database migrations
pnpm migration:run

# Start in development (watch mode)
pnpm start:dev

# Start production build
pnpm build
pnpm start:prod
```

## Available Scripts

| Command | Description |
|---|---|
| `pnpm start:dev` | Start with hot-reload |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start:prod` | Run compiled build |
| `pnpm test` | Run all unit tests |
| `pnpm test:watch` | Unit tests in watch mode |
| `pnpm test:cov` | Unit tests with coverage report |
| `pnpm test:e2e` | Run E2E tests |
| `pnpm lint` | Lint and auto-fix |
| `pnpm format` | Format with Prettier |
| `pnpm migration:run` | Run pending migrations |
| `pnpm migration:generate -- src/database/migrations/<Name>` | Generate migration from entity diff |
| `pnpm migration:revert` | Revert last migration |
| `pnpm seed` | Run database seeds (dev/staging only) |

## API

All routes are prefixed `/api/v1`. Responses follow `StandardResponse<T>`. Errors follow RFC 7807 Problem Detail.

Health check: `GET /api/v1/health`

API docs (non-production): `GET /api/docs`

## Environment Variables

Copy `.env.example` to `.env` and fill in values. Never commit `.env`.

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` \| `staging` \| `production` |
| `PORT` | HTTP server port (default `3000`) |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | PostgreSQL connection |
| `DB_SSL` | Set `true` to enable SSL |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis connection |
| `JWT_PRIVATE_KEY` | PEM-encoded RS256 private key (newlines as `\n`) |
| `JWT_PUBLIC_KEY` | PEM-encoded RS256 public key (newlines as `\n`) |
| `JWT_ACCESS_TOKEN_EXPIRES_IN` | Access token TTL (default `15m`) |
| `JWT_REFRESH_TOKEN_EXPIRES_IN` | Refresh token TTL (default `7d`) |
| `S3_ENDPOINT` | S3-compatible endpoint URL |
| `S3_REGION` | S3 region |
| `S3_BUCKET` | S3 bucket for PDF exports |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3 credentials |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | Default rate limit (60 req / 60 s per userId) |
| `AUTH_THROTTLE_TTL` / `AUTH_THROTTLE_LIMIT` | Auth endpoint rate limit (10 req / 60 s per IP) |
| `OTP_THROTTLE_TTL` / `OTP_THROTTLE_LIMIT` | OTP rate limit (3 req / 300 s per userId) |
| `EXPORT_THROTTLE_TTL` / `EXPORT_THROTTLE_LIMIT` | Export token rate limit (5 req / 60 s per orgId) |
| `OTP_TTL_SECONDS` | OTP validity window in Redis (default `300`) |
| `BCRYPT_SALT_ROUNDS` | bcrypt cost factor (default `12`) |

## Architecture

See [documentation/ARCHITECTURE.md](documentation/ARCHITECTURE.md) for full entity schemas, API contracts, business rules, and inter-module dependency graph.

See [documentation/CLAUDE.md](documentation/CLAUDE.md) for coding conventions, folder structure rules, and hard constraints enforced across all sessions.
