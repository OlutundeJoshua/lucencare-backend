// TODO: Implement — see docs/modules/programs.md

import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

import { ProgramType } from 'src/common/enums';

const CRITERION_OPERATORS = ['eq', 'in', 'gte', 'lte', 'contains'] as const;

export class EligibilityCriterionDto {
  @ApiProperty() @IsString() @IsNotEmpty() field: string;

  @ApiProperty({ enum: CRITERION_OPERATORS })
  @IsIn(CRITERION_OPERATORS)
  operator: (typeof CRITERION_OPERATORS)[number];

  @ApiProperty() value: unknown;
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
}
