import {
  ArrayMinSize,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMedicationDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;

  @ApiProperty() @IsString() @IsNotEmpty() dosage: string;

  @ApiProperty() @IsString() @IsNotEmpty() condition: string;

  @ApiProperty() @IsString() @IsNotEmpty() frequency: string;

  @ApiProperty({ type: [String], description: 'Dose times, e.g. "8:00 AM"' })
  @IsString({ each: true })
  @ArrayMinSize(1)
  scheduleTimes: string[];

  @ApiProperty() @IsString() @IsNotEmpty() prescriber: string;

  @ApiProperty() @IsString() @IsNotEmpty() specialty: string;

  @ApiProperty() @IsInt() @Min(1) pillsTotal: number;

  @ApiProperty({ description: 'ISO date (YYYY-MM-DD)' }) @IsISO8601({ strict: true }) refillDate: string;

  @ApiPropertyOptional() @IsOptional() @IsString() rxnormCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
