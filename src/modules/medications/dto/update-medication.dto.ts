import {
  ArrayMinSize,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMedicationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() dosage?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() condition?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() frequency?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  @ArrayMinSize(1)
  scheduleTimes?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() prescriber?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() specialty?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) pillsTotal?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) pillsRemaining?: number;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  refillDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() rxnormCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
