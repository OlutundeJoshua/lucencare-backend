// TODO: Implement — see docs/modules/admin.md

import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminApproveDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Required when status is "rejected"' })
  @ValidateIf((o) => o.status === 'rejected')
  @IsNotEmpty({ message: 'Reason is required when rejecting' })
  @IsString()
  reason?: string;
}
