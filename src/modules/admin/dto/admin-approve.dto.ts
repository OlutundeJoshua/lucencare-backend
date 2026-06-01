// TODO: Implement — see docs/modules/admin.md

import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminApproveDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Required when status is "rejected". Max 1000 characters.' })
  @ValidateIf((o) => o.status === 'rejected')
  @IsNotEmpty({ message: 'Reason is required when rejecting' })
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
