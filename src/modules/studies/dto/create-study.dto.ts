// TODO: Implement — see docs/modules/studies.md

import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StudyEligibilityCriterionDto {
  @ApiProperty() @IsString() @IsNotEmpty() field: string;
  @ApiProperty() @IsString() @IsNotEmpty() operator: string;
  @ApiProperty() value: unknown;
}

export class CreateStudyDto {
  @ApiProperty() @IsString() @IsNotEmpty() title: string;

  @ApiProperty({ description: 'IRB number in format IRB-YYYY-NNNN' })
  @IsString()
  @Matches(/^IRB-\d{4}-\d{4}$/, { message: 'IRB number must match IRB-YYYY-NNNN' })
  irbNumber: string;

  @ApiProperty({ type: [StudyEligibilityCriterionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StudyEligibilityCriterionDto)
  eligibilityCriteria: StudyEligibilityCriterionDto[];

  @ApiProperty() @IsUrl() infoSheetUrl: string;

  @ApiProperty() @IsInt() @IsPositive() targetCount: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) compensationDetails?: string;
}
