import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { EligibilityCriterionDto } from './create-program.dto';

/**
 * What an NGO may change on its own programme.
 *
 * WHICH of these are accepted depends on the review state, enforced in
 * ProgramsService.assertEditable(): draft, in-review and rejected programmes take
 * everything here; an approved one takes only `paused` and a later `expiresAt`,
 * because patients have already applied under its stated terms.
 *
 * Deliberately excluded at every state:
 * - `type` — a funding programme cannot become something else.
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
   * Who qualifies. Editable while the programme is still a draft or has come back
   * rejected — fixing the criteria is usually the whole reason it was rejected.
   * Refused once approved, where it would silently re-scope a live programme.
   */
  @ApiPropertyOptional({ type: [EligibilityCriterionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EligibilityCriterionDto)
  eligibilityCriteria?: EligibilityCriterionDto[];

  /**
   * Pause or resume intake. A boolean rather than a timestamp so the client states
   * intent and the server owns the clock.
   */
  @ApiPropertyOptional({ description: 'true pauses intake, false resumes it' })
  @IsOptional()
  @IsBoolean()
  paused?: boolean;
}
