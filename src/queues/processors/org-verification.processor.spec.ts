// TODO: Implement — see docs/specs/queues.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { OrgVerificationProcessor } from './org-verification.processor';

describe('OrgVerificationProcessor', () => {
  let processor: OrgVerificationProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrgVerificationProcessor],
    }).compile();
    processor = module.get<OrgVerificationProcessor>(OrgVerificationProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
