// TODO: Implement — see docs/modules/patients.md

import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CareEventType } from 'src/common/enums';

export class MedicationItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rxnormCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dosage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() frequency?: string;
}

export class CreatePatientDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;

  @ApiPropertyOptional({ description: 'SHA-256 hex hash of phone number (64 chars)' })
  @IsOptional()
  @IsString()
  phoneHash?: string;

  @ApiPropertyOptional()
  @ValidateIf((o) => !o.phoneHash)
  @IsNotEmpty({ message: 'At least one of phoneHash or membershipNumber is required' })
  @IsString()
  membershipNumber?: string;

  @ApiProperty({ type: [String] }) @IsString({ each: true }) conditionTags: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() locationState?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() locationLga?: string;

  @ApiPropertyOptional({ type: [MedicationItemDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MedicationItemDto)
  medicationList?: MedicationItemDto[];
}

export class UpdatePatientDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  conditionTags?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() locationState?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() locationLga?: string;

  @ApiPropertyOptional({ type: [MedicationItemDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MedicationItemDto)
  medicationList?: MedicationItemDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() directContactShared?: boolean;
}

export class LookupPatientDto {
  @ApiPropertyOptional({ description: 'SHA-256 hex hash of phone number' })
  @IsOptional()
  @IsString()
  phoneHash?: string;

  @ApiPropertyOptional()
  @ValidateIf((o) => !o.phoneHash)
  @IsNotEmpty({ message: 'At least one of phoneHash or membershipNumber is required' })
  @IsString()
  membershipNumber?: string;
}

export class CreateCareEventDto {
  @ApiProperty({ enum: CareEventType }) @IsEnum(CareEventType) type: CareEventType;

  @ApiProperty({ description: 'ISO date (YYYY-MM-DD)' }) @IsISO8601() eventDate: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) providerName?: string;

  @ApiProperty({ description: 'Type-specific structured data' }) @IsObject() structured: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
