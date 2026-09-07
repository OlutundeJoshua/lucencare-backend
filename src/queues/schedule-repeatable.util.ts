import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

/**
 * Registers a cron-driven job exactly once, and clears out registrations left behind by
 * earlier deploys.
 *
 * The bug this exists to prevent: `queue.add(name, {}, { repeat: { pattern } })` keys the
 * repeatable job on `name:jobId:endDate:tz:pattern` (bullmq/classes/repeat.js), so the
 * cron pattern is part of the identity. Changing a pattern therefore registers a SECOND
 * scheduler instead of updating the first, and nothing removes the old one — both keep
 * firing, and every email that job sends goes out twice. Change the pattern twice and it
 * goes out three times. The entries live in Redis, so a redeploy does not clear them.
 *
 * `upsertJobScheduler` is keyed only by the scheduler id, which we pin to the job name.
 * A pattern change then updates that one entry in place, and this stays idempotent
 * across restarts and across instances booting at once.
 */
export async function scheduleRepeatable(
  queue: Queue,
  jobName: string,
  pattern: string,
  logger: Logger,
): Promise<void> {
  await removeStaleRegistrations(queue, jobName, logger);

  // The scheduler id is the job name, so there can only ever be one per job. The
  // template's name must match too — the queue's processor dispatches on job name, and
  // a mismatch would leave the tick firing into `default: return` and silently stop
  // every reminder it drives.
  await queue.upsertJobScheduler(jobName, { pattern }, { name: jobName, data: {} });
}

/**
 * Drops any registration for this job whose key is not the scheduler id we manage —
 * i.e. the pattern-hashed keys written by earlier deploys.
 *
 * Failures are logged rather than thrown: a Redis hiccup here would otherwise fail boot
 * for a cleanup, and leaving a stale entry causes duplicate sends, not an outage.
 */
async function removeStaleRegistrations(
  queue: Queue,
  jobName: string,
  logger: Logger,
): Promise<void> {
  let existing: Awaited<ReturnType<Queue['getRepeatableJobs']>>;
  try {
    existing = await queue.getRepeatableJobs();
  } catch (err) {
    logger.error(`Could not read repeatable jobs for ${jobName}: ${(err as Error).message}`);
    return;
  }

  for (const job of existing) {
    if (job.name !== jobName || job.key === jobName) continue;

    try {
      await queue.removeRepeatableByKey(job.key);
      logger.warn(
        `Removed a stale ${jobName} schedule (pattern=${job.pattern ?? job.every}) left by an earlier deploy — it would have sent every one of this job's emails a second time.`,
      );
    } catch (err) {
      logger.error(
        `Failed to remove stale ${jobName} schedule ${job.key}: ${(err as Error).message}`,
      );
    }
  }
}
