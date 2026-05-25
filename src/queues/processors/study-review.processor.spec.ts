// TODO: Implement — see docs/specs/queues.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { StudyReviewProcessor } from './study-review.processor';

describe('StudyReviewProcessor', () => {
  let processor: StudyReviewProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StudyReviewProcessor],
    }).compile();
    processor = module.get<StudyReviewProcessor>(StudyReviewProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
