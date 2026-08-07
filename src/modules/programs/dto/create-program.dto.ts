import {
  Allow,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ProgramType } from 'src/common/enums';

const CRITERION_OPERATORS = ['eq', 'in', 'gte', 'lte', 'contains'] as const;

export class EligibilityCriterionDto {
  @ApiProperty() @IsString() @IsNotEmpty() field: string;

  @ApiProperty({ enum: CRITERION_OPERATORS })
  @IsIn(CRITERION_OPERATORS)
  operator: (typeof CRITERION_OPERATORS)[number];

  @ApiProperty() @Allow() value: unknown;
}

export class CreateProgramDto {
  @ApiProperty() @IsString() @IsNotEmpty() title: string;

  @ApiProperty({ enum: ProgramType }) @IsEnum(ProgramType) type: ProgramType;

  @ApiProperty({ type: [EligibilityCriterionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EligibilityCriterionDto)
  eligibilityCriteria: EligibilityCriterionDto[];

  @ApiProperty({ description: 'ISO 8601 datetime string' }) @IsDateString() expiresAt: string;

  // ── Programme detail ───────────────────────────────────────────────────────
  // Optional so the existing create contract still works; the UI collects them.

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() description?: string;

  @ApiPropertyOptional({ description: 'Short summary, e.g. "Diabetes · Hypertension"' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  focus?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() donor?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() coordinator?: string;

  @ApiPropertyOptional({ description: 'Total budget in MINOR units (kobo)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetTotal?: number;

  @ApiPropertyOptional({ description: 'Number of patient places' })
  @IsOptional()
  @IsInt()
  @Min(0)
  slotsTotal?: number;

  // budgetDisbursed and slotsFilled are deliberately absent: both are maintained by
  // the platform as patients are selected and funds released. An NGO that could set
  // them directly could claim capacity or spend it had not actually committed.
}
