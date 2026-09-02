import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { AppointmentConfirmationAction } from 'src/common/enums';
import { SEND_APPOINTMENT_CONFIRMATION_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { SendAppointmentConfirmationJob } from 'src/queues/interfaces/send-appointment-confirmation-job.interface';

// Add a new action to AppointmentConfirmationAction (src/common/enums) and a matching
// entry here — no other branching logic needed.
const APPOINTMENT_CONFIRMATION_COPY: Record<
  AppointmentConfirmationAction,
  { subject: string; verb: string }
> = {
  [AppointmentConfirmationAction.CREATED]: {
    subject: 'Your appointment is confirmed',
    verb: 'is confirmed for',
  },
  [AppointmentConfirmationAction.RESCHEDULED]: {
    subject: 'Your appointment has been rescheduled',
    verb: 'has been rescheduled to',
  },
};

@Injectable()
export class SendAppointmentConfirmationProcessor {
  constructor(private readonly mailService: MailService) {}

  async process(job: Job<SendAppointmentConfirmationJob>): Promise<void> {
    if (job.name !== SEND_APPOINTMENT_CONFIRMATION_JOB) return;

    const { to, patientName, appointmentDate, time, provider, specialty, facility, action } =
      job.data;
    const { subject, verb } = APPOINTMENT_CONFIRMATION_COPY[action];

    await this.mailService.send(to, subject, {
      preheader: `${appointmentDate} at ${time}, ${facility}.`,
      blocks: [
        { kind: 'paragraph', text: `Hi ${patientName},` },
        // The whole point of the email, so it gets the callout treatment rather than
        // sitting in the flow of body copy.
        {
          kind: 'callout',
          text: `Your ${specialty} appointment with ${provider} ${verb} ${appointmentDate} at ${time}, at ${facility}.`,
        },
        {
          kind: 'paragraph',
          text: 'If you have any questions or need to make changes, please contact us.',
        },
        { kind: 'signoff', text: 'The LucenCare Team' },
      ],
    });
  }
}
