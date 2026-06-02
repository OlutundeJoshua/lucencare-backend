import { ArrayMinSize, IsArray, IsEnum, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { ConsentPurpose } from 'src/common/enums';

export class CreateConsentGrantDto {
  @ApiProperty({ enum: ConsentPurpose })
  @IsEnum(ConsentPurpose)
  purpose: ConsentPurpose;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  dataScopes: string[];
}
