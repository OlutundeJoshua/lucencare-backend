// TODO: Implement — see docs/modules/export.md

import { Controller, Post, Body } from '@nestjs/common';

import { ExportService } from './export.service';
import { CreateTokenDto } from './dto/create-token.dto';

@Controller('tokens')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post()
  createToken(@Body() dto: CreateTokenDto) {
    return this.exportService.createToken(dto);
  }
}
