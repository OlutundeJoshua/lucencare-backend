import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';

import { AppointmentConfirmationAction } from 'src/common/enums';
import { SEND_APPOINTMENT_CONFIRMATION_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';

import { SendAppointmentConfirmationProcessor } from './send-appointment-confirmation.processor';

describe('SendAppointmentConfirmationProcessor', () => {
  let processor: SendAppointmentConfirmationProcessor;
  let mailService: { send: jest.Mock };

  const baseData = {
    to: 'patient@example.com',
    patientName: 'Ada Okafor',
    appointmentDate: '2026-08-01',
    time: '10:30 AM',
    provider: 'Dr Chen',
    specialty: 'General Practice',
    facility: 'Lucen Health Centre',
  };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SendAppointmentConfirmationProcessor, { provide: MailService, useValue: mailService }],
    }).compile();

    processor = module.get<SendAppointmentConfirmationProcessor>(SendAppointmentConfirmationProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('sends a confirmation-worded email when the appointment was created', async () => {
    const job = {
      name: SEND_APPOINTMENT_CONFIRMATION_JOB,
      data: { ...baseData, action: AppointmentConfirmationAction.CREATED },
    } as Job;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = mailService.send.mock.calls[0];
    expect(to).toBe('patient@example.com');
    expect(subject).toBe('Your appointment is confirmed');
    expect(body).toContain('is confirmed for');
    expect(body).not.toContain('rescheduled');
  });

  it('sends a reschedule-worded email when the appointment was rescheduled', async () => {
    const job = {
      name: SEND_APPOINTMENT_CONFIRMATION_JOB,
      data: { ...baseData, action: AppointmentConfirmationAction.RESCHEDULED },
    } as Job;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = mailService.send.mock.calls[0];
    expect(to).toBe('patient@example.com');
    expect(subject).toBe('Your appointment has been rescheduled');
    expect(body).toContain('has been rescheduled to');
  });

  it('does nothing for a non-matching job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
