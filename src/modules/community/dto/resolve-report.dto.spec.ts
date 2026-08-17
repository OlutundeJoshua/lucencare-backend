import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CommunityModerationAction } from 'src/common/enums';

import { ResolveReportDto } from './resolve-report.dto';

async function errorsFor(payload: Record<string, unknown>) {
  return validate(plainToInstance(ResolveReportDto, payload));
}

describe('ResolveReportDto', () => {
  // A removal with no stated reason is both unauditable and impossible for the
  // author to learn from — the note is shown to them verbatim.
  describe('note is required when hiding', () => {
    it('rejects a hide with no note', async () => {
      const errors = await errorsFor({ action: CommunityModerationAction.HIDE });
      expect(errors.map((e) => e.property)).toContain('note');
    });

    it('rejects a hide with a whitespace-only note', async () => {
      const errors = await errorsFor({ action: CommunityModerationAction.HIDE, note: '   ' });
      expect(errors.map((e) => e.property)).toContain('note');
    });

    it('accepts a hide with a real note', async () => {
      expect(
        await errorsFor({ action: CommunityModerationAction.HIDE, note: 'Contains a phone number' }),
      ).toHaveLength(0);
    });
  });

  it('does not require a note to dismiss', async () => {
    expect(await errorsFor({ action: CommunityModerationAction.DISMISS })).toHaveLength(0);
  });

  it('rejects an action that is not hide or dismiss', async () => {
    const errors = await errorsFor({ action: 'delete' });
    expect(errors.map((e) => e.property)).toContain('action');
  });
});
