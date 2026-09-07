import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { scheduleRepeatable } from './schedule-repeatable.util';

const JOB = 'medication_reminder_tick';

describe('scheduleRepeatable', () => {
  let queue: {
    getRepeatableJobs: jest.Mock;
    removeRepeatableByKey: jest.Mock;
    upsertJobScheduler: jest.Mock;
  };
  let logger: Logger;

  beforeEach(() => {
    queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    };
    logger = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;
  });

  const run = (pattern = '*/5 * * * *') =>
    scheduleRepeatable(queue as unknown as Queue, JOB, pattern, logger);

  it('registers the schedule keyed on the job name', async () => {
    await run();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      JOB,
      { pattern: '*/5 * * * *' },
      { name: JOB, data: {} },
    );
  });

  // The template name must match the job name, or the queue's processor dispatches the
  // tick into `default: return` and every reminder it drives silently stops.
  it('gives the produced jobs the name the queue processor dispatches on', async () => {
    await run();

    expect(queue.upsertJobScheduler.mock.calls[0][2]).toEqual({ name: JOB, data: {} });
  });

  describe('stale registrations from earlier deploys', () => {
    // The bug this exists for. A repeatable job's key encodes its cron pattern, so
    // changing the pattern used to add a second schedule and leave the first firing.
    it('removes a schedule left behind by a previous pattern', async () => {
      queue.getRepeatableJobs.mockResolvedValue([
        { name: JOB, key: 'hash-of-30-min', pattern: '*/30 * * * *' },
      ]);

      await run();

      expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('hash-of-30-min');
      expect(queue.upsertJobScheduler).toHaveBeenCalled();
    });

    it('removes every stale schedule when more than one accumulated', async () => {
      queue.getRepeatableJobs.mockResolvedValue([
        { name: JOB, key: 'hash-a', pattern: '*/30 * * * *' },
        { name: JOB, key: 'hash-b', pattern: '* * * * *' },
        { name: JOB, key: 'hash-c', pattern: '*/10 * * * *' },
      ]);

      await run();

      expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(3);
    });

    it('leaves the scheduler it manages alone', async () => {
      queue.getRepeatableJobs.mockResolvedValue([{ name: JOB, key: JOB, pattern: '*/5 * * * *' }]);

      await run();

      expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalled();
    });

    it('never touches another job on the same queue', async () => {
      queue.getRepeatableJobs.mockResolvedValue([
        { name: 'medication_missed_sweep', key: 'hash-other', pattern: '*/15 * * * *' },
      ]);

      await run();

      expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
    });

    it('names the removed pattern in the warning, so the cause is visible in the logs', async () => {
      queue.getRepeatableJobs.mockResolvedValue([
        { name: JOB, key: 'hash-of-30-min', pattern: '*/30 * * * *' },
      ]);

      await run();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('*/30 * * * *'));
    });
  });

  describe('when Redis misbehaves', () => {
    // A stale entry causes duplicate sends, not an outage — so cleanup failures must
    // not stop the app booting.
    it('still registers the schedule when the stale-job read fails', async () => {
      queue.getRepeatableJobs.mockRejectedValue(new Error('READONLY'));

      await expect(run()).resolves.toBeUndefined();

      expect(queue.upsertJobScheduler).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('continues past a removal that fails and still registers', async () => {
      queue.getRepeatableJobs.mockResolvedValue([
        { name: JOB, key: 'hash-a', pattern: '*/30 * * * *' },
        { name: JOB, key: 'hash-b', pattern: '* * * * *' },
      ]);
      queue.removeRepeatableByKey.mockRejectedValueOnce(new Error('gone'));

      await expect(run()).resolves.toBeUndefined();

      expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(2);
      expect(queue.upsertJobScheduler).toHaveBeenCalled();
    });
  });

  // Boot must be able to fail loudly if the schedule itself cannot be written: with no
  // scheduler registered, no reminder would ever go out.
  it('propagates a failure to register the schedule', async () => {
    queue.upsertJobScheduler.mockRejectedValue(new Error('connection lost'));

    await expect(run()).rejects.toThrow('connection lost');
  });
});
