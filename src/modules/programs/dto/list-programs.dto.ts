import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { ProgramStatus } from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class ListProgramsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ProgramStatus })
  @IsOptional()
  @IsEnum(ProgramStatus)
  status?: ProgramStatus;
}
