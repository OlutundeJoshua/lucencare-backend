import { IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MedicationScheduleQueryDto {
  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD) — defaults to today' })
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;
}
