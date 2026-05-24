// TODO: Implement — see docs/modules/consents.md

import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';

import { ConsentsService } from './consents.service';
import { CreateConsentGrantDto, UpdateConsentDto } from './dto/consent.dto';

@Controller('consents')
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @Get('me')
  listMine() {
    return this.consentsService.listForCurrentPatient();
  }

  @Post()
  create(@Body() dto: CreateConsentGrantDto) {
    return this.consentsService.create(dto);
  }

  @Patch(':id')
  transition(@Param('id') id: string, @Body() dto: UpdateConsentDto) {
    return this.consentsService.transition(id, dto);
  }

  @Get(':id/impact')
  getImpact(@Param('id') id: string) {
    return this.consentsService.getImpact(id);
  }
}
