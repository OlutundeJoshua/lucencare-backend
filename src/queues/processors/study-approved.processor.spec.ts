// TODO: Implement — see docs/specs/queues.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { StudyApprovedProcessor } from './study-approved.processor';

describe('StudyApprovedProcessor', () => {
  let processor: StudyApprovedProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StudyApprovedProcessor],
    }).compile();
    processor = module.get<StudyApprovedProcessor>(StudyApprovedProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
