import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Equals,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ConsentPurpose, Gender, OrgType, UserRole } from 'src/common/enums';
import { LOGIN_CLIENT_ROLES, SIGNUP_CLIENT_ROLES } from 'src/common/constants/client-roles';

export class RegisterPatientDto {
  @ApiProperty() @IsEmail() email: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password: string;

  @ApiProperty() @IsString() @IsNotEmpty() name: string;

  @ApiProperty({ description: 'Patient phone number' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ description: 'HMO membership number' })
  @IsOptional()
  @IsString()
  membershipNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;

  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;

  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) conditionTags: string[];

  @ApiProperty({ enum: ConsentPurpose, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
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

  @ApiProperty({ description: '6-digit OTP code' })
  @IsString()
  @Length(6, 6)
  otpCode: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;

  @ApiProperty() @IsString() @IsNotEmpty() password: string;

  // Part of the credential, not a hint: an account may only sign in from the
  // portal matching its own role. See AuthService.login.
  @ApiProperty({
    enum: LOGIN_CLIENT_ROLES,
    description: 'Portal the user is signing in from',
  })
  @IsIn(LOGIN_CLIENT_ROLES)
  role: string;
}

export class RequestOtpDto {
  @ApiProperty({ description: 'Institutional email address for OTP delivery' })
  @IsEmail()
  email: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: '64-char hex reset token from email link' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password: string;
}

export class SignupDto {
  @ApiProperty({ minLength: 2 }) @IsString() @MinLength(2) name: string;

  @ApiProperty() @IsEmail() email: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password: string;

  @ApiProperty({ enum: SIGNUP_CLIENT_ROLES })
  @IsIn(SIGNUP_CLIENT_ROLES)
  role: string;
}

export class PatientOnboardingDto {
  @ApiProperty({ enum: ['patient', 'caregiver'] })
  @IsIn(['patient', 'caregiver'])
  accountType: 'patient' | 'caregiver';

  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) dateOfBirth?: string;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other'] })
  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  biologicalSex?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;

  /**
   * Optional so the wizard can collect it only where it means something (the state
   * list is Nigeria-shaped), and so an existing client that does not send it still
   * completes onboarding. Editable afterwards via PATCH /patients/me.
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

  @ApiPropertyOptional({ description: 'Comma-separated conditions e.g. "Diabetes, Hypertension"' })
  @IsOptional()
  @IsString()
  conditions?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() primaryLanguage?: string;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must accept the terms and privacy policy' })
  termsConsent: true;

  @ApiProperty() @IsBoolean() ngoConsent: boolean;

  @ApiProperty() @IsBoolean() researchConsent: boolean;
}

export class NgoOnboardingDto {
  @ApiProperty() @IsString() @IsNotEmpty() orgName: string;

  @ApiProperty() @IsString() @IsNotEmpty() registrationNumber: string;

  @ApiProperty({ description: 'Tax Identification Number' })
  @IsString()
  @IsNotEmpty()
  tin: string;

  @ApiProperty({ description: 'SCUML certificate number' })
  @IsString()
  @IsNotEmpty()
  scumlNumber: string;

  @ApiProperty() @IsString() @IsNotEmpty() focusAreas: string;

  @ApiPropertyOptional() @IsOptional() @IsUrl() website?: string;

  @ApiProperty() @IsString() @IsNotEmpty() operatingRegions: string;

  @ApiProperty() @IsString() @IsNotEmpty() headOfficeCountry: string;

  @ApiProperty() @IsString() @IsNotEmpty() programDescription: string;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must accept the terms of service' })
  termsConsent: true;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must accept the data processing agreement' })
  dataProcessingConsent: true;
}

export class HmoOnboardingDto {
  @ApiProperty() @IsString() @IsNotEmpty() orgName: string;

  @ApiProperty() @IsString() @IsNotEmpty() licenceNumber: string;

  @ApiProperty() @IsString() @IsNotEmpty() contactPhone: string;

  @ApiProperty() @IsString() @IsNotEmpty() coverageRegion: string;

  @ApiProperty() @IsString() @IsNotEmpty() enrolledPatientCount: string;

  @ApiPropertyOptional() @IsOptional() @IsString() specialtyFocus?: string;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must acknowledge the BAA' })
  baaAcknowledgement: true;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must accept the terms of service' })
  termsConsent: true;
}

