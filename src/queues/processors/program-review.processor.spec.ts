// TODO: Implement — see docs/specs/queues.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { ProgramReviewProcessor } from './program-review.processor';

describe('ProgramReviewProcessor', () => {
  let processor: ProgramReviewProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProgramReviewProcessor],
    }).compile();
    processor = module.get<ProgramReviewProcessor>(ProgramReviewProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
