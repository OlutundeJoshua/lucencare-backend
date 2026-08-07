import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { PaginationDto } from 'src/common/dto/pagination.dto';
import { NotificationType } from 'src/common/enums';

export class ListNotificationsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Return only notifications not yet read' })
  @IsOptional()
  // Query strings carry 'true'/'false' as text, and enableImplicitConversion coerces
  // any non-empty string to `true` — so ?unreadOnly=false would mean the opposite of
  // what it says. Read the raw value off the source object, before that coercion.
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    return raw === true || raw === 'true';
  })
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;
}
