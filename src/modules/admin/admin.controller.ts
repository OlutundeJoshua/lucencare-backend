// TODO: Implement — see docs/modules/admin.md

import { Controller, Patch, Param, Body } from '@nestjs/common';

import { AdminService } from './admin.service';
import { AdminApproveDto } from './dto/admin-approve.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Patch('programs/:id')
  reviewProgram(@Param('id') id: string, @Body() dto: AdminApproveDto) {
    return this.adminService.reviewProgram(id, dto);
  }

  @Patch('studies/:id')
  reviewStudy(@Param('id') id: string, @Body() dto: AdminApproveDto) {
    return this.adminService.reviewStudy(id, dto);
  }

  @Patch('organizations/:id')
  reviewOrganization(@Param('id') id: string, @Body() dto: AdminApproveDto) {
    return this.adminService.reviewOrganization(id, dto);
  }
}
