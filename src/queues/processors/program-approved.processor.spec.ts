// TODO: Implement — see docs/specs/queues.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { ProgramApprovedProcessor } from './program-approved.processor';

describe('ProgramApprovedProcessor', () => {
  let processor: ProgramApprovedProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProgramApprovedProcessor],
    }).compile();
    processor = module.get<ProgramApprovedProcessor>(ProgramApprovedProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
