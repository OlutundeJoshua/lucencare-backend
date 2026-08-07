import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ReviewEnrollmentDto } from './review-enrollment.dto';

function validate(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(ReviewEnrollmentDto, payload), { whitelist: true });
}

function errorFor(payload: Record<string, unknown>, property: string) {
  return validate(payload).find((e) => e.property === property);
}

describe('ReviewEnrollmentDto', () => {
  it.each(['selected', 'waitlisted'])('accepts %s with no reason', (status) => {
    expect(validate({ status })).toHaveLength(0);
  });

  it('accepts a rejection with a reason', () => {
    expect(validate({ status: 'rejected', reason: 'Outside catchment area' })).toHaveLength(0);
  });

  /**
   * The gap this DTO originally had: @IsOptional() short-circuits on undefined even
   * when @ValidateIf says the field applies, so a rejection with no reason validated
   * cleanly and reached the service.
   */
  it('rejects a rejection with no reason at all', () => {
    const error = errorFor({ status: 'rejected' }, 'reason');
    expect(error).toBeDefined();
    expect(Object.values(error!.constraints ?? {}).join(' ')).toContain('reason is required');
  });

  it.each([{ reason: '' }, { reason: '   ' }, { reason: null }])(
    'rejects a rejection whose reason is %p',
    (over) => {
      expect(errorFor({ status: 'rejected', ...over }, 'reason')).toBeDefined();
    },
  );

  it('rejects a reason longer than 1000 characters', () => {
    expect(errorFor({ status: 'rejected', reason: 'x'.repeat(1001) }, 'reason')).toBeDefined();
  });

  // The other three statuses belong to the patient or the system, not the reviewer.
  it.each(['active', 'revoked_by_patient', 'expired', 'nonsense'])(
    'refuses %s as a review outcome',
    (status) => {
      expect(errorFor({ status }, 'status')).toBeDefined();
    },
  );
});
