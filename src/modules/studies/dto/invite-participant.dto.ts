// TODO: Implement — see docs/modules/studies.md

import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteParticipantDto {
  @ApiProperty({ description: 'ULID of the study enrollment to invite' })
  @IsString()
  @Length(26)
  studyEnrollmentId: string;
}
