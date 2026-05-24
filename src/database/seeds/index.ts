// TODO: Implement — see docs/modules/database.md
// Seeds are idempotent: INSERT ... ON CONFLICT DO NOTHING
// Run manually in development/staging only: npm run seed

import AppDataSource from '../data-source';

async function seed() {
  await AppDataSource.initialize();

  // Seed platform admin user, sample orgs, etc.
  // Each seed must be idempotent

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
