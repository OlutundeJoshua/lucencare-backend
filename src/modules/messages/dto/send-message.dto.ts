// TODO: Implement — see docs/modules/messages.md

import {
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@ValidatorConstraint({ name: 'ExactlyOneFK', async: false })
class ExactlyOneFKConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as SendMessageDto;
    const count = [obj.enrollmentId, obj.studyEnrollmentId].filter(Boolean).length;
    return count === 1;
  }
  defaultMessage() {
    return 'Exactly one of enrollmentId or studyEnrollmentId must be provided';
  }
}

export class SendMessageDto {
  @ApiPropertyOptional({ description: 'ULID of enrollment (mutually exclusive with studyEnrollmentId)' })
  @IsOptional()
  @IsString()
  @Length(26)
  enrollmentId?: string;

  @ApiPropertyOptional({ description: 'ULID of study enrollment (mutually exclusive with enrollmentId)' })
  @IsOptional()
  @IsString()
  @Length(26)
  studyEnrollmentId?: string;

  @ApiProperty({ minLength: 1, maxLength: 5000 })
  @Validate(ExactlyOneFKConstraint)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body: string;
}
