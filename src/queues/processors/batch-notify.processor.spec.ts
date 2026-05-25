// TODO: Implement — see docs/specs/queues.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { BatchNotifyProcessor } from './batch-notify.processor';

describe('BatchNotifyProcessor', () => {
  let processor: BatchNotifyProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BatchNotifyProcessor],
    }).compile();
    processor = module.get<BatchNotifyProcessor>(BatchNotifyProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
