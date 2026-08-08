import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { OrgStatus, OrgType } from 'src/common/enums';

export class ListOrganizationsDto {
  @ApiPropertyOptional({ enum: OrgStatus, description: 'Filter by org status' })
  @IsOptional()
  @IsEnum(OrgStatus)
  status?: OrgStatus;

  @ApiPropertyOptional({ enum: OrgType, description: 'Filter by org type' })
  @IsOptional()
  @IsEnum(OrgType)
  type?: OrgType;

  @ApiPropertyOptional({ description: 'ULID cursor for keyset pagination' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;
}
