import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CareEventType, Gender, HmoLinkRequestStatus } from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class MedicationItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rxnormCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dosage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() frequency?: string;
}

export class CreatePatientDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;

  @ApiProperty() @IsEmail() email: string;

  @ApiProperty() @IsString() @IsNotEmpty() phone: string;

  @ApiPropertyOptional() @IsOptional() @IsString() membershipNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;

  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;

  @ApiProperty({ type: [String] }) @IsString({ each: true }) conditionTags: string[];

  @ApiPropertyOptional({ type: [MedicationItemDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MedicationItemDto)
  medicationList?: MedicationItemDto[];
}

export class UpdatePatientDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  conditionTags?: string[];

  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;

  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;

  /**
   * Structured location. Editable here so a patient who onboarded before these
   * columns existed is not permanently unlocatable — without an edit path, the
   * coverage map would only ever cover new sign-ups.
   */
  @ApiPropertyOptional({ description: 'State or region, e.g. "Lagos"' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  locationState?: string;

  @ApiPropertyOptional({ description: 'Local government area' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  locationLga?: string;

  @ApiPropertyOptional({ type: [MedicationItemDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MedicationItemDto)
  medicationList?: MedicationItemDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() directContactShared?: boolean;
}

export class LookupPatientDto {
  @ApiPropertyOptional({ description: 'Patient phone number' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  membershipNumber?: string;
}

export class RespondToLinkRequestDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';
}

export class ListLinkRequestsQueryDto {
  @ApiPropertyOptional({ enum: HmoLinkRequestStatus })
  @IsOptional()
  @IsEnum(HmoLinkRequestStatus)
  status?: HmoLinkRequestStatus;
}

export class CreateCareEventDto {
  @ApiProperty({ enum: CareEventType }) @IsEnum(CareEventType) type: CareEventType;

  @ApiProperty({ description: 'ISO date (YYYY-MM-DD)' }) @IsISO8601() eventDate: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) providerName?: string;

  @ApiProperty({ description: 'Type-specific structured data' }) @IsObject() structured: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CareEventQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: CareEventType })
  @IsOptional()
  @IsEnum(CareEventType)
  type?: CareEventType;
}
