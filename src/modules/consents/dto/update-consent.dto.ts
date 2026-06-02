import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { ConsentStatus } from 'src/common/enums';

export class UpdateConsentDto {
  @ApiProperty({ enum: ConsentStatus })
  @IsEnum(ConsentStatus)
  status: ConsentStatus;
}
