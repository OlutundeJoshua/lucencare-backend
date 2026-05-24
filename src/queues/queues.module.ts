// TODO: Implement — see docs/modules/queues.md

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

import { NOTIFICATIONS_QUEUE, ADMIN_QUEUE, MAIL_QUEUE } from './queues.constants';

import { FanOutNotifyProcessor } from './processors/fan-out-notify.processor';
import { BatchNotifyProcessor } from './processors/batch-notify.processor';
import { ConsentRevokedProcessor } from './processors/consent-revoked.processor';
import { ProgramReviewProcessor } from './processors/program-review.processor';
import { StudyReviewProcessor } from './processors/study-review.processor';
import { OrgVerificationProcessor } from './processors/org-verification.processor';
import { ProgramApprovedProcessor } from './processors/program-approved.processor';
import { StudyApprovedProcessor } from './processors/study-approved.processor';
import { SendOtpProcessor } from './processors/send-otp.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('app.redisHost', 'localhost'),
          port: configService.get<number>('app.redisPort', 6379),
          password: configService.get<string>('app.redisPassword'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: NOTIFICATIONS_QUEUE },
      { name: ADMIN_QUEUE },
      { name: MAIL_QUEUE },
    ),
  ],
  providers: [
    FanOutNotifyProcessor,
    BatchNotifyProcessor,
    ConsentRevokedProcessor,
    ProgramReviewProcessor,
    StudyReviewProcessor,
    OrgVerificationProcessor,
    ProgramApprovedProcessor,
    StudyApprovedProcessor,
    SendOtpProcessor,
  ],
  exports: [BullModule],
})
export class QueuesModule {}
