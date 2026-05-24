// TODO: Implement — see docs/modules/enrollments.md

import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEnrollmentDto {
  @ApiProperty({ description: 'ULID of the program to enroll in' })
  @IsString()
  @Length(26)
  programId: string;
}

export class CreateStudyEnrollmentDto {
  @ApiProperty({ description: 'ULID of the study to enroll in' })
  @IsString()
  @Length(26)
  studyId: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  shareDirectContact: boolean = false;
}
