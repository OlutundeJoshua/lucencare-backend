import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CommunityReportReason } from 'src/common/enums';

import { CreateReportDto } from './create-report.dto';

async function errorsFor(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateReportDto, payload);
  return validate(dto);
}

describe('CreateReportDto', () => {
  it('accepts a known reason with no detail', async () => {
    expect(await errorsFor({ reason: CommunityReportReason.HARASSMENT })).toHaveLength(0);
  });

  it('rejects an unknown reason', async () => {
    const errors = await errorsFor({ reason: 'because-i-said-so' });
    expect(errors.map((e) => e.property)).toContain('reason');
  });

  // The @IsOptional()/@ValidateIf trap: @IsOptional() short-circuits on undefined
  // regardless of the condition, so a required-when-X field silently never fires.
  // The same bug once shipped a reject-with-no-reason as a 200.
  describe('details is required only when the reason is "other"', () => {
    it('rejects "other" with no detail at all', async () => {
      const errors = await errorsFor({ reason: CommunityReportReason.OTHER });
      expect(errors.map((e) => e.property)).toContain('details');
    });

    it('rejects "other" with an empty detail', async () => {
      const errors = await errorsFor({ reason: CommunityReportReason.OTHER, details: '' });
      expect(errors.map((e) => e.property)).toContain('details');
    });

    it('rejects "other" with a whitespace-only detail', async () => {
      const errors = await errorsFor({ reason: CommunityReportReason.OTHER, details: '    ' });
      expect(errors.map((e) => e.property)).toContain('details');
    });

    it('accepts "other" with a real detail', async () => {
      expect(
        await errorsFor({ reason: CommunityReportReason.OTHER, details: 'Impersonating a doctor' }),
      ).toHaveLength(0);
    });

    it('does not require detail for any other reason', async () => {
      for (const reason of Object.values(CommunityReportReason)) {
        if (reason === CommunityReportReason.OTHER) continue;
        expect(await errorsFor({ reason })).toHaveLength(0);
      }
    });
  });

  it('trims the detail before it is stored', async () => {
    const dto = plainToInstance(CreateReportDto, {
      reason: CommunityReportReason.OTHER,
      details: '  shares a phone number  ',
    });
    expect(dto.details).toBe('shares a phone number');
  });
});
