// Seeds are idempotent: each block uses ON CONFLICT DO NOTHING or check-before-insert.
// Run manually in development/staging only: pnpm run seed

import * as bcrypt from 'bcrypt';
import { ulid } from 'ulid';

import AppDataSource from '../data-source';

async function seed() {
  await AppDataSource.initialize();

  await seedPlatformAdmin();

  await AppDataSource.destroy();
}

// Seeded credentials (dev/staging only — change in production via env-driven admin invite flow)
const ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    ?? 'admin@lucencare.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@1234';

async function seedPlatformAdmin(): Promise<void> {
  const existing = await AppDataSource.query(
    `SELECT id FROM users WHERE email = $1`,
    [ADMIN_EMAIL],
  );
  if (existing.length > 0) {
    console.log(`Admin user already exists (${ADMIN_EMAIL}) — skipping`);
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const id = ulid();

  await AppDataSource.query(
    `INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'platform_admin', 'active', NOW(), NOW())
     ON CONFLICT (email) DO NOTHING`,
    [id, ADMIN_EMAIL, passwordHash],
  );

  console.log(`Seeded platform admin: ${ADMIN_EMAIL}`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
