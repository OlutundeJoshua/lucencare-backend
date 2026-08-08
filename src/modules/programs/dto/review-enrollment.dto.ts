import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EnrollmentStatus, REVIEWABLE_ENROLLMENT_STATUSES, ReviewableEnrollmentStatus } from 'src/common/enums';

export class ReviewEnrollmentDto {
  @ApiProperty({ enum: REVIEWABLE_ENROLLMENT_STATUSES })
  @IsIn(REVIEWABLE_ENROLLMENT_STATUSES)
  status: ReviewableEnrollmentStatus;

  /**
   * Required on rejection: a patient told only "not approved" has nothing to act on,
   * and the same reason is shown in-app and emailed.
   */
  // No @IsOptional() here: it short-circuits on undefined regardless of @ValidateIf,
  // which let a rejection through with no reason at all. @ValidateIf already makes
  // the field optional for the other two statuses by skipping every validator.
  @ApiPropertyOptional({ description: 'Required when rejecting' })
  // Trimmed before validation so whitespace cannot satisfy @IsNotEmpty, and so the
  // patient is never emailed a reason that is only spaces.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((o: ReviewEnrollmentDto) => o.status === EnrollmentStatus.REJECTED)
  @IsString({ message: 'A reason is required when rejecting an applicant' })
  @IsNotEmpty({ message: 'A reason is required when rejecting an applicant' })
  @MaxLength(1000)
  reason?: string;
}
