import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import { User } from 'src/modules/auth/entities/user.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';

import {
  NOTIFICATIONS_QUEUE,
  ADMIN_QUEUE,
  MAIL_QUEUE,
  QUEUE_DEFAULT_JOB_OPTIONS,
} from './queues.constants';

import { FanOutNotifyProcessor } from './processors/fan-out-notify.processor';
import { BatchNotifyProcessor } from './processors/batch-notify.processor';
import { ConsentRevokedProcessor } from './processors/consent-revoked.processor';
import { ProgramReviewProcessor } from './processors/program-review.processor';
import { StudyReviewProcessor } from './processors/study-review.processor';
import { ApplicationReviewProcessor } from './processors/application-review.processor';
import { CommunityReportProcessor } from './processors/community-report.processor';
import { OrgVerificationProcessor } from './processors/org-verification.processor';
import { ProgramOutcomeProcessor } from './processors/program-outcome.processor';
import { StudyApprovedProcessor } from './processors/study-approved.processor';
import { SendOtpProcessor } from './processors/send-otp.processor';
import { SendResetPasswordProcessor } from './processors/send-reset-password.processor';
import { SendPatientCredentialsProcessor } from './processors/send-patient-credentials.processor';
import { MedicationReminderTickProcessor } from './processors/medication-reminder-tick.processor';
import { MedicationRefillCheckProcessor } from './processors/medication-refill-check.processor';
import { MedicationMissedSweepProcessor } from './processors/medication-missed-sweep.processor';
import { SendMedicationReminderEmailProcessor } from './processors/send-medication-reminder-email.processor';
import { SendAppointmentConfirmationProcessor } from './processors/send-appointment-confirmation.processor';
import { AppointmentReminderTickProcessor } from './processors/appointment-reminder-tick.processor';
import { SendAppointmentReminderProcessor } from './processors/send-appointment-reminder.processor';
import { SendPatientOnboardingWelcomeProcessor } from './processors/send-patient-onboarding-welcome.processor';
import { SendApplicationStatusProcessor } from './processors/send-application-status.processor';
import { SendEnrollmentOutcomeProcessor } from './processors/send-enrollment-outcome.processor';
import { SendProgramStatusProcessor } from './processors/send-program-status.processor';
import { MailQueueProcessor } from './processors/mail-queue.processor';
import { NotificationsQueueProcessor } from './processors/notifications-queue.processor';
import { AdminQueueProcessor } from './processors/admin-queue.processor';

import { AppointmentsModule } from 'src/modules/appointments/appointments.module';
import { MedicationsModule } from 'src/modules/medications/medications.module';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { MailModule } from 'src/modules/mail/mail.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('app.redisHost', 'localhost'),
          port: configService.get<number>('app.redisPort', 6379),
          username: configService.get<string>('app.redisUsername', 'default'),
          password: configService.get<string>('app.redisPassword'),
          ...(configService.get<boolean>('app.redisTls') ? { tls: {} } : {}),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: NOTIFICATIONS_QUEUE, defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS },
      { name: ADMIN_QUEUE, defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS },
      { name: MAIL_QUEUE, defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS },
    ),
    // OrgVerificationProcessor and ProgramReviewProcessor resolve the platform-admin
    // recipient list; ProgramOutcomeProcessor resolves the NGO's staff and org name.
    TypeOrmModule.forFeature([User, Organization]),
    MedicationsModule,
    AppointmentsModule,
    NotificationsModule,
    MailModule,
  ],
  providers: [
    FanOutNotifyProcessor,
    BatchNotifyProcessor,
    ConsentRevokedProcessor,
    ProgramReviewProcessor,
    StudyReviewProcessor,
    OrgVerificationProcessor,
    ProgramOutcomeProcessor,
    StudyApprovedProcessor,
    SendOtpProcessor,
    SendResetPasswordProcessor,
    SendPatientCredentialsProcessor,
    MedicationReminderTickProcessor,
    MedicationRefillCheckProcessor,
    MedicationMissedSweepProcessor,
    SendMedicationReminderEmailProcessor,
    SendAppointmentConfirmationProcessor,
    AppointmentReminderTickProcessor,
    SendAppointmentReminderProcessor,
    SendPatientOnboardingWelcomeProcessor,
    SendApplicationStatusProcessor,
    SendEnrollmentOutcomeProcessor,
    SendProgramStatusProcessor,
    ApplicationReviewProcessor,
    CommunityReportProcessor,
    MailQueueProcessor,
    NotificationsQueueProcessor,
    AdminQueueProcessor,
  ],
  exports: [BullModule],
})
export class QueuesModule {}
