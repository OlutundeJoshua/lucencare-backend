// TODO: Implement — see docs/specs/queues.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { FanOutNotifyProcessor } from './fan-out-notify.processor';

describe('FanOutNotifyProcessor', () => {
  let processor: FanOutNotifyProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FanOutNotifyProcessor],
    }).compile();
    processor = module.get<FanOutNotifyProcessor>(FanOutNotifyProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
