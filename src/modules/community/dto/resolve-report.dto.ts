import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CommunityModerationAction } from 'src/common/enums';

export class ResolveReportDto {
  @ApiProperty({ enum: CommunityModerationAction })
  @IsEnum(CommunityModerationAction)
  action: CommunityModerationAction;

  /**
   * Required when hiding. The note is shown to the author verbatim — a removal with
   * no stated reason is both unauditable and impossible to learn from.
   */
  // No @IsOptional(): see CreateReportDto for why it cannot sit beside @ValidateIf.
  @ApiPropertyOptional({ description: 'Required when hiding; shown to the author' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((o: ResolveReportDto) => o.action === CommunityModerationAction.HIDE)
  @IsString({ message: 'A reason is required when removing content' })
  @IsNotEmpty({ message: 'A reason is required when removing content' })
  @MaxLength(1000)
  note?: string;
}
