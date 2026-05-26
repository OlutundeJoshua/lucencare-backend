// TODO: Implement — see docs/modules/auth.md

import {
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ConsentPurpose, Gender, OrgType, UserRole } from 'src/common/enums';

export class RegisterPatientDto {
  @ApiProperty() @IsEmail() email!: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;

  @ApiProperty() @IsString() @IsNotEmpty() name!: string;

  @ApiProperty({ description: 'Patient phone number' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiPropertyOptional({ description: 'HMO membership number' })
  @IsOptional()
  @IsString()
  membershipNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;

  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;

  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) conditionTags!: string[];

  @ApiProperty({ enum: ConsentPurpose, isArray: true })
  @IsArray()
  @IsEnum(ConsentPurpose, { each: true })
  consentPurposes!: ConsentPurpose[];
}

export class RegisterOrgDto {
  @ApiProperty() @IsEmail() email!: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;

  @ApiProperty() @IsString() @IsNotEmpty() orgName!: string;

  @ApiProperty({ enum: OrgType }) @IsEnum(OrgType) orgType!: OrgType;

  @ApiProperty() @IsEmail() contactEmail!: string;

  @ApiProperty({ enum: [UserRole.NGO_ADMIN, UserRole.HMO_COORDINATOR] })
  @IsIn([UserRole.NGO_ADMIN, UserRole.HMO_COORDINATOR])
  role!: UserRole.NGO_ADMIN | UserRole.HMO_COORDINATOR;
}

export class RegisterResearcherDto {
  @ApiProperty() @IsEmail() email!: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;

  @ApiProperty() @IsString() @IsNotEmpty() institutionName!: string;

  @ApiProperty({ description: '6-digit OTP code' }) @IsString() @Length(6) otpCode!: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() email!: string;

  @ApiProperty() @IsString() @IsNotEmpty() password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: '64-char hex reset token from email link' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;
}
