import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Direct admin hide/restore, independent of any report. */
export class SetVisibilityDto {
  @ApiProperty()
  @IsBoolean()
  hidden: boolean;

  // No @IsOptional(): see CreateReportDto for why it cannot sit beside @ValidateIf.
  @ApiPropertyOptional({ description: 'Required when hiding; shown to the author' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((o: SetVisibilityDto) => o.hidden === true)
  @IsString({ message: 'A reason is required when removing content' })
  @IsNotEmpty({ message: 'A reason is required when removing content' })
  @MaxLength(1000)
  reason?: string;
}
