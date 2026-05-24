// TODO: Implement — see docs/modules/export.md

import { IsEnum, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

import { TokenPurpose } from 'src/common/enums';

export class CreateTokenDto {
  @ApiProperty({ enum: TokenPurpose }) @IsEnum(TokenPurpose) purpose: TokenPurpose;

  @ApiProperty({ description: 'ULID of the patient' }) @IsString() @Length(26) patientId: string;

  @ApiProperty({ description: 'Token TTL in seconds', minimum: 30, maximum: 120 })
  @IsInt()
  @Min(30)
  @Max(120)
  @Type(() => Number)
  ttl: number;
}
