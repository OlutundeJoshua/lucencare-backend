// TODO: Implement — see docs/specs/queues.spec.md

import { Test, TestingModule } from '@nestjs/testing';
import { SendOtpProcessor } from './send-otp.processor';

describe('SendOtpProcessor', () => {
  let processor: SendOtpProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SendOtpProcessor],
    }).compile();
    processor = module.get<SendOtpProcessor>(SendOtpProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
