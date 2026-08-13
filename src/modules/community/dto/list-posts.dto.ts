import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { PaginationDto } from 'src/common/dto/pagination.dto';

export class ListPostsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Only posts carrying this tag' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;
}
