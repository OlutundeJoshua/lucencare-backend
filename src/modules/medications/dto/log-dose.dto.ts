import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LOGGABLE_DOSE_STATUSES, LoggableDoseStatus } from 'src/common/enums';

export class LogDoseDto {
  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD) — defaults to today' })
  @IsOptional()
  @IsISO8601({ strict: true })
  doseDate?: string;

  @ApiProperty({ description: 'Scheduled dose time, e.g. "8:00 AM"' })
  @IsString()
  @IsNotEmpty()
  scheduledTime: string;

  @ApiProperty({ enum: LOGGABLE_DOSE_STATUSES })
  @IsIn(LOGGABLE_DOSE_STATUSES)
  status: LoggableDoseStatus;
}
