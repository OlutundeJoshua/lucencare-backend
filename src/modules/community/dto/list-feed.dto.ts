import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { ListPostsDto } from './list-posts.dto';

/**
 * The one post-listing query in the module. It serves the feed tab, the filter chips
 * and the group page alike — a second `GET /communities/:id/posts` would be the same
 * query reached by a different URL, and the two would drift.
 */
export class ListFeedDto extends ListPostsDto {
  @ApiPropertyOptional({ description: 'Narrow to one community' })
  @IsOptional()
  @IsString()
  @Length(26, 26)
  communityId?: string;

  @ApiPropertyOptional({ description: 'Only communities the caller has joined' })
  @IsOptional()
  // Read from the raw query object: enableImplicitConversion coerces "false" to a
  // truthy boolean before a @Transform on `value` would see the string.
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key] === 'true' || obj[key] === true)
  @IsBoolean()
  joinedOnly?: boolean;
}
