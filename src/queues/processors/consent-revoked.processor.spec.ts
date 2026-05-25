// TODO: Implement — see docs/specs/queues.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { ConsentRevokedProcessor } from './consent-revoked.processor';

describe('ConsentRevokedProcessor', () => {
  let processor: ConsentRevokedProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConsentRevokedProcessor],
    }).compile();
    processor = module.get<ConsentRevokedProcessor>(ConsentRevokedProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
