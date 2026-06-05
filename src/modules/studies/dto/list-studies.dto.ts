import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { StudyStatus, StudyEnrollmentStatus } from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class ListStudiesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: StudyStatus })
  @IsOptional()
  @IsEnum(StudyStatus)
  status?: StudyStatus;
}

export class ListStudyEnrollmentsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: StudyEnrollmentStatus })
  @IsOptional()
  @IsEnum(StudyEnrollmentStatus)
  status?: StudyEnrollmentStatus;
}
