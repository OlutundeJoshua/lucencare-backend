import {
  Equals,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ApplicationStatus, ProfessionType } from 'src/common/enums';

export class ProfessionalOnboardingDto {
  @ApiProperty({ enum: ProfessionType }) @IsEnum(ProfessionType) profession: ProfessionType;

  @ApiProperty() @IsString() @IsNotEmpty() licenseNumber: string;

  @ApiProperty() @IsString() @IsNotEmpty() specialty: string;

  @ApiProperty({ minimum: 0 }) @IsNumber() @Min(0) yearsOfExperience: number;

  @ApiProperty() @IsString() @IsNotEmpty() phone: string;

  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10) bio: string;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must accept the terms of service' })
  termsConsent: true;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must accept the code of conduct' })
  codeOfConductConsent: true;
}

export class BenefactorOnboardingDto {
  @ApiProperty() @IsString() @IsNotEmpty() fullName: string;

  @ApiProperty() @IsString() @IsNotEmpty() phone: string;

  @ApiProperty({ minLength: 20 }) @IsString() @MinLength(20) reasonForSupport: string;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must consent to identity verification' })
  idConsent: true;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must accept the terms of service' })
  termsConsent: true;

  @ApiProperty({ description: 'Must be true to proceed' })
  @Equals(true, { message: 'You must accept the code of conduct' })
  codeOfConductConsent: true;
}

export class UpdateProfessionalBioDto {
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10) @MaxLength(2000) bio: string;
}

export class ReviewApplicationDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  @ApiPropertyOptional({ description: 'Required when action is reject' })
  @ValidateIf((o: ReviewApplicationDto) => o.action === 'reject')
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ListApplicationsQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
