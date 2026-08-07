import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What an NGO may change on its own programme after creation.
 *
 * Deliberately excluded:
 * - `type` and `eligibilityCriteria` — changing who qualifies after patients have
 *   applied would silently re-scope a programme people already enrolled in.
 * - `status` — the platform review state is the admin's to set, not the NGO's.
 * - `budgetDisbursed` / `slotsFilled` — platform-maintained counters.
 */
export class UpdateProgramDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() title?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() focus?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() donor?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() coordinator?: string;

  @ApiPropertyOptional({ description: 'Total budget in MINOR units (kobo)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetTotal?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) slotsTotal?: number;

  @ApiPropertyOptional({ description: 'ISO 8601 datetime string' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  /**
   * Pause or resume intake. A boolean rather than a timestamp so the client states
   * intent and the server owns the clock.
   */
  @ApiPropertyOptional({ description: 'true pauses intake, false resumes it' })
  @IsOptional()
  @IsBoolean()
  paused?: boolean;
}
