import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CommunityReportReason } from 'src/common/enums';

export class CreateReportDto {
  @ApiProperty({ enum: CommunityReportReason })
  @IsEnum(CommunityReportReason)
  reason: CommunityReportReason;

  /**
   * Required when the reason is OTHER — a report that says only "other" gives the
   * moderator nothing to act on.
   */
  // No @IsOptional() alongside @ValidateIf: @IsOptional() short-circuits on
  // undefined regardless of the condition, so the requirement would never fire.
  @ApiPropertyOptional({ description: 'Required when reason is "other"' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((o: CreateReportDto) => o.reason === CommunityReportReason.OTHER)
  @IsString({ message: 'Tell us what is wrong when choosing "other"' })
  @IsNotEmpty({ message: 'Tell us what is wrong when choosing "other"' })
  @MaxLength(500)
  details?: string;
}
