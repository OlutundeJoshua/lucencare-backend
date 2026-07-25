import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RescheduleAppointmentDto {
  @ApiProperty({ description: 'ISO date (YYYY-MM-DD)' })
  @IsISO8601({ strict: true })
  appointmentDate: string;

  @ApiProperty({ description: "Display time, e.g. '10:30 AM'" })
  @IsString()
  @IsNotEmpty()
  time: string;

  @ApiProperty({ description: "Display duration label, e.g. '30 min'" })
  @IsString()
  @IsNotEmpty()
  duration: string;

  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
