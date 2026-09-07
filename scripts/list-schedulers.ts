/**
 * Lists every repeatable job and job scheduler registered in Redis, per queue.
 *
 * Read-only: it opens a connection, prints, and exits. Nothing is added, removed or
 * consumed, so it is safe to point at production.
 *
 * Why this exists: BullMQ derives a legacy repeatable job's key from
 * `name:jobId:endDate:tz:pattern` (see repeat.js). The cron pattern is part of the key,
 * so changing MEDICATION_REMINDER_TICK_CRON (or any other) registers a SECOND
 * scheduler rather than updating the first — and nothing removes the old one. Both then
 * fire, and every reminder goes out twice.
 *
 * Usage:
 *   pnpm run schedulers:list                       # uses .env
 *   REDIS_HOST=... REDIS_PASSWORD=... REDIS_TLS=true pnpm run schedulers:list
 */
import * as dotenv from 'dotenv';

import { Queue } from 'bullmq';

import { ADMIN_QUEUE, MAIL_QUEUE, NOTIFICATIONS_QUEUE } from 'src/queues/queues.constants';

dotenv.config();

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  username: process.env.REDIS_USERNAME ?? 'default',
  password: process.env.REDIS_PASSWORD,
  ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
};

async function inspect(name: string): Promise<number> {
  const queue = new Queue(name, { connection });

  try {
    const repeatables = await queue.getRepeatableJobs();
    const schedulers = await queue.getJobSchedulers();

    console.log(`\n── queue: ${name}`);
    console.log(
      `   waiting=${await queue.getWaitingCount()}` +
        ` delayed=${await queue.getDelayedCount()}` +
        ` active=${await queue.getActiveCount()}` +
        ` failed=${await queue.getFailedCount()}`,
    );

    if (repeatables.length === 0 && schedulers.length === 0) {
      console.log('   (no repeatable jobs registered)');
      return 0;
    }

    // Grouped by job name: more than one entry for a name is the duplicate-send bug.
    const byName = new Map<string, string[]>();
    for (const r of repeatables) {
      const line = `pattern=${r.pattern ?? r.every ?? '?'}  next=${
        r.next ? new Date(r.next).toISOString() : 'n/a'
      }  key=${r.key}`;
      byName.set(r.name, [...(byName.get(r.name) ?? []), line]);
    }

    let duplicates = 0;
    for (const [jobName, lines] of byName) {
      const flag = lines.length > 1 ? '  <<< DUPLICATE — this job fires more than once' : '';
      console.log(`   ${jobName}: ${lines.length} registration(s)${flag}`);
      for (const line of lines) console.log(`      ${line}`);
      if (lines.length > 1) duplicates++;
    }

    if (schedulers.length > 0) {
      console.log(
        `   job schedulers (modern API): ${schedulers.map((s) => s.key ?? s.name).join(', ')}`,
      );
    }

    return duplicates;
  } finally {
    await queue.close();
  }
}

async function main(): Promise<void> {
  console.log(
    `Redis ${connection.host}:${connection.port} (tls=${process.env.REDIS_TLS === 'true'})`,
  );

  let duplicates = 0;
  for (const name of [NOTIFICATIONS_QUEUE, MAIL_QUEUE, ADMIN_QUEUE]) {
    duplicates += await inspect(name);
  }

  console.log(
    duplicates === 0
      ? '\nNo duplicate registrations found.'
      : `\n${duplicates} job(s) registered more than once — each fires that many times per schedule.`,
  );
  process.exit(0);
}

void main();
