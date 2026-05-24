// TODO: Implement — see docs/modules/auth.md

import {
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ConsentPurpose, OrgType, UserRole } from 'src/common/enums';

export class RegisterPatientDto {
  @ApiProperty() @IsEmail() email: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password: string;

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

  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) conditionTags: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() locationState?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() locationLga?: string;

  @ApiProperty({ enum: ConsentPurpose, isArray: true })
  @IsArray()
  @IsEnum(ConsentPurpose, { each: true })
  consentPurposes: ConsentPurpose[];
}

export class RegisterOrgDto {
  @ApiProperty() @IsEmail() email: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password: string;

  @ApiProperty() @IsString() @IsNotEmpty() orgName: string;

  @ApiProperty({ enum: OrgType }) @IsEnum(OrgType) orgType: OrgType;

  @ApiProperty() @IsEmail() contactEmail: string;

  @ApiProperty({ enum: [UserRole.NGO_ADMIN, UserRole.HMO_COORDINATOR] })
  @IsIn([UserRole.NGO_ADMIN, UserRole.HMO_COORDINATOR])
  role: UserRole.NGO_ADMIN | UserRole.HMO_COORDINATOR;
}

export class RegisterResearcherDto {
  @ApiProperty() @IsEmail() email: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password: string;

  @ApiProperty() @IsString() @IsNotEmpty() institutionName: string;

  @ApiProperty({ description: '6-digit OTP code' }) @IsString() @Length(6) otpCode: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;

  @ApiProperty() @IsString() @IsNotEmpty() password: string;
}
