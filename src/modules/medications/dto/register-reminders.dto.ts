import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterRemindersDto {
  @ApiProperty({ description: 'IANA timezone, e.g. "Africa/Lagos"' })
  @IsString()
  @IsNotEmpty()
  timezone: string;
}
