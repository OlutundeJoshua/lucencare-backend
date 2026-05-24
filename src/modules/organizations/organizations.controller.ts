// TODO: Implement — see docs/modules/organizations.md

import { Controller, Get, Param } from '@nestjs/common';

import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Get(':id/programs')
  listPrograms(@Param('id') id: string) {
    return this.organizationsService.listPrograms(id);
  }
}
