import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AllowPending } from 'src/common/decorators/allow-pending.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

import { ApplicationsService } from './applications.service';
import { UpdateProfessionalBioDto } from './dto/applications.dto';

@ApiTags('applications')
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  // Self-service. Everything else on an application is fixed once submitted —
  // the bio is presentational and the professional owns it.
  @Patch('professional/me/bio')
  @AllowPending()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.PROFESSIONAL)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update your own professional bio' })
  @ApiResponse({ status: 200, description: 'Bio updated' })
  @ApiResponse({ status: 404, description: 'No professional application for this user' })
  updateOwnBio(@Body() dto: UpdateProfessionalBioDto, @CurrentUser() user: JwtPayload) {
    return this.applicationsService.updateProfessionalBio(user.sub, dto.bio);
  }
}
