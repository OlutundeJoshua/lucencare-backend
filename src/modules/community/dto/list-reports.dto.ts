import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { CommunityReportStatus } from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class ListReportsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: CommunityReportStatus })
  @IsOptional()
  @IsEnum(CommunityReportStatus)
  status?: CommunityReportStatus;
}
