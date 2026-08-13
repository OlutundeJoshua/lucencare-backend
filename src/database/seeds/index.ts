// Seeds are idempotent: each block uses ON CONFLICT DO NOTHING or check-before-insert.
// Run manually in development/staging only: pnpm run seed

import * as bcrypt from 'bcrypt';
import { ulid } from 'ulid';

import AppDataSource from '../data-source';

async function seed() {
  await AppDataSource.initialize();

  await seedPlatformAdmin();
  await seedStarterCommunities();

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

/**
 * The starter set of communities.
 *
 * A community platform with no communities is an empty room: a new user's first
 * action — post — has nowhere to go, and nothing to browse. Only patients and
 * platform admins may found one, so without this a fresh environment is deadlocked
 * until some patient happens to create the first.
 *
 * In production these are created by an admin through
 * `POST /admin/community/communities`; this seed is the dev/staging equivalent.
 * Owned by the seeded platform admin, and deliberately NOT joined by them —
 * member_count starts at 0 because an admin is not a participant.
 */
const STARTER_COMMUNITIES: Array<{
  slug: string;
  name: string;
  icon: string;
  accent: string;
  description: string;
  tags: string[];
}> = [
  { slug: 'diabetes-support', name: 'Diabetes Support', icon: '🩺', accent: '#D97706',
    description: 'Living with type 1 or type 2 — medication, monitoring and the day to day of it.',
    tags: ['Diabetes', 'HbA1c', 'Metformin'] },
  { slug: 'heart-health', name: 'Heart Health', icon: '❤️', accent: '#DC2626',
    description: 'Cardiac conditions, recovery and keeping your heart well.',
    tags: ['HeartHealth', 'Cholesterol'] },
  { slug: 'hypertension-hub', name: 'Hypertension Hub', icon: '💊', accent: '#7C3AED',
    description: 'Blood pressure: tracking it, treating it, and living with it.',
    tags: ['BloodPressure', 'Hypertension'] },
  { slug: 'general-wellness', name: 'General Wellness', icon: '🌿', accent: '#059669',
    description: 'Everyday health, habits and staying on top of your care.',
    tags: ['Wellness', 'MedicationAdherence'] },
  { slug: 'nutrition-and-diet', name: 'Nutrition & Diet', icon: '🥗', accent: '#0D9488',
    description: 'Eating well alongside a condition — what worked, what did not.',
    tags: ['Nutrition', 'HealthyEating'] },
  { slug: 'mental-wellness', name: 'Mental Wellness', icon: '🧠', accent: '#4F46E5',
    description: 'Anxiety, low mood and the mental side of managing a long-term condition.',
    tags: ['MentalHealth', 'HealthAnxiety'] },
];

async function seedStarterCommunities(): Promise<void> {
  const admins = await AppDataSource.query(
    `SELECT id FROM users WHERE role = 'platform_admin' ORDER BY id LIMIT 1`,
  );
  if (admins.length === 0) {
    console.log('No platform admin to own the starter communities — skipping');
    return;
  }
  const ownerId = admins[0].id;

  let created = 0;
  for (const c of STARTER_COMMUNITIES) {
    // Check-before-insert rather than ON CONFLICT: the uniqueness index on slug is
    // partial (WHERE deleted_at IS NULL), and ON CONFLICT cannot target a partial
    // index without naming its exact predicate.
    const existing = await AppDataSource.query(
      `SELECT id FROM communities WHERE slug = $1 AND deleted_at IS NULL`,
      [c.slug],
    );
    if (existing.length > 0) continue;

    await AppDataSource.query(
      `INSERT INTO communities
         (id, name, slug, description, icon, accent, tags, status,
          member_count, post_count, created_by_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 0, 0, $8, NOW(), NOW())`,
      [ulid(), c.name, c.slug, c.description, c.icon, c.accent, c.tags, ownerId],
    );
    created++;
  }

  console.log(
    created > 0
      ? `Seeded ${created} starter communit${created === 1 ? 'y' : 'ies'}`
      : 'Starter communities already present — skipping',
  );
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
