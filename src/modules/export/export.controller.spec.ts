// TODO: Implement — see docs/specs/export.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

const mockExportService = {
  createToken: jest.fn(),
  validateAndConsumeToken: jest.fn(),
  buildPdf: jest.fn(),
};

describe('ExportController', () => {
  let controller: ExportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportController],
      providers: [{ provide: ExportService, useValue: mockExportService }],
    }).compile();
    controller = module.get<ExportController>(ExportController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
