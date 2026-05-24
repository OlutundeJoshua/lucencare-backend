// TODO: Implement — see docs/modules/organizations.md

import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { OrgType } from 'src/common/enums';

export class CreateOrganizationDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;

  @ApiProperty({ enum: OrgType }) @IsEnum(OrgType) type: OrgType;

  @ApiProperty() @IsEmail() contactEmail: string;
}
