import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;

  /**
   * The comment being replied to. Nesting is one level: a reply to a reply is
   * re-parented onto its top-level ancestor by the service rather than rejected —
   * the client should not have to know the depth rule to post successfully.
   */
  @ApiPropertyOptional({ description: 'ULID of the comment being replied to' })
  @IsOptional()
  @IsString()
  @Length(26, 26)
  parentCommentId?: string;
}
