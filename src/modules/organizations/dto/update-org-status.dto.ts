import { IsEnum, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { OrgStatus } from 'src/common/enums';

// Note: service method uses positional args (id, status, adminId) — not this DTO —
// to remain compatible with AdminService's existing call pattern.
// This DTO documents the shape for Swagger and for future direct HTTP use.
export class UpdateOrgStatusDto {
  @ApiProperty({ enum: OrgStatus })
  @IsEnum(OrgStatus)
  status: OrgStatus;

  @ApiProperty({ description: 'ULID of the admin user performing the update' })
  @IsString()
  @Length(26)
  verifiedBy: string;
}
