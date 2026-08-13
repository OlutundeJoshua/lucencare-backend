import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { PaginationDto } from 'src/common/dto/pagination.dto';

export class ListCommunitiesDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Only communities carrying this tag' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tag?: string;

  @ApiPropertyOptional({ description: 'Only communities the caller has joined' })
  @IsOptional()
  // Read from the raw query object, not the transformed value: with
  // enableImplicitConversion the pipe coerces "false" to a truthy boolean before a
  // @Transform on `value` ever sees the string.
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key] === 'true' || obj[key] === true)
  @IsBoolean()
  joinedOnly?: boolean;
}
